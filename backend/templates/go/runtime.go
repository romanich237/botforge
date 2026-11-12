package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

type Button struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Action string `json:"action"`
	URL    string `json:"url"`
}
type NodeData struct {
	Text        string   `json:"text"`
	Command     string   `json:"command"`
	TriggerText string `json:"triggerText"`
	TriggerMode string `json:"triggerMode"`
	Description string   `json:"description"`
	Variable    string   `json:"variable"`
	Validation  string   `json:"validation"`
	Error       string   `json:"error"`
	Choices     string   `json:"choices"`
	Operation   string   `json:"operation"`
	Value       string   `json:"value"`
	Placement   string   `json:"placement"`
	Buttons     []Button `json:"buttons"`
}
type Node struct {
	ID   string   `json:"id"`
	Type string   `json:"type"`
	Data NodeData `json:"data"`
}
type Edge struct {
	Source string `json:"source"`
	Output string `json:"output"`
	Target string `json:"target"`
}
type Variable struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Initial any    `json:"initial"`
}
type Project struct {
	Nodes     []Node         `json:"nodes"`
	Edges     []Edge         `json:"edges"`
	Variables []Variable     `json:"variables"`
	Behavior  map[string]any `json:"behavior"`
}
type Choice struct {
	Label    string  `json:"label"`
	Action   string  `json:"action"`
	URL      *string `json:"url"`
	Callback string  `json:"callback"`
}
type Link struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}
type Menu struct {
	NodeID    string
	Buttons   []Choice
	Placement string
}
type Event map[string]any

type Session struct {
	Project         Project
	Values          map[string]any
	Menus           map[string]Menu
	MenuOrder       []string
	Waiting         string
	Current         string
	Deadline        *int64
	Times           []int64
	LastLimitNotice *int64
	Key             string
	Sequence        int
}

func NewSession(p Project, key string) *Session {
	if key == "" {
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			panic("Не удалось создать идентификатор сессии")
		}
		key = hex.EncodeToString(b)
	}
	s := &Session{Project: p, Key: key, Menus: map[string]Menu{}}
	s.resetValues()
	return s
}
func (s *Session) resetValues() {
	s.Values = map[string]any{}
	for _, v := range s.Project.Variables {
		s.Values[v.Name] = v.Initial
	}
}
func (s *Session) flag(key string, fallback bool) bool {
	v, ok := s.Project.Behavior[key].(bool)
	if ok {
		return v
	}
	return fallback
}
func (s *Session) number(key string) float64 { v, _ := s.Project.Behavior[key].(float64); return v }
func (s *Session) option(key, fallback string) string {
	v, _ := s.Project.Behavior[key].(string)
	if v == "" {
		return fallback
	}
	return v
}
func valueText(v any) string {
	if n, ok := v.(float64); ok {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

var variablePattern = regexp.MustCompile(`\{([^{}]+)\}`)
var numberPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
var mentionPattern = regexp.MustCompile(`@[A-Za-z0-9_]+$`)

func numeric(text string) (float64, bool) {
	if !numberPattern.MatchString(text) {
		return 0, false
	}
	v, err := strconv.ParseFloat(text, 64)
	return v, err == nil && !math.IsNaN(v) && !math.IsInf(v, 0)
}
func (s *Session) text(text string) string {
	return variablePattern.ReplaceAllStringFunc(text, func(key string) string {
		v, ok := s.Values[key[1:len(key)-1]]
		if ok {
			return valueText(v)
		}
		return key
	})
}
func (s *Session) node(id string) *Node {
	for i := range s.Project.Nodes {
		if s.Project.Nodes[i].ID == id {
			return &s.Project.Nodes[i]
		}
	}
	return nil
}
func (s *Session) next(id, output string) string {
	for _, e := range s.Project.Edges {
		if e.Source == id && e.Output == output {
			return e.Target
		}
	}
	return ""
}
func (s *Session) start() string {
	for _, n := range s.Project.Nodes {
		if n.Type == "start" {
			return n.ID
		}
	}
	return ""
}
func (s *Session) clearMenus() []Event {
	if len(s.MenuOrder) == 0 {
		return nil
	}
	tokens := append([]string{}, s.MenuOrder...)
	links := map[string][]Link{}
	for _, token := range tokens {
		links[token] = []Link{}
		for _, b := range s.Menus[token].Buttons {
			if b.Action == "url" && b.URL != nil {
				links[token] = append(links[token], Link{b.Label, *b.URL})
			}
		}
	}
	s.Menus = map[string]Menu{}
	s.MenuOrder = nil
	return []Event{{"type": "disable", "tokens": tokens, "links": links}}
}
func (s *Session) message(text string, node *Node) Event {
	s.Sequence++
	token := s.Key + "-" + strconv.Itoa(s.Sequence)
	buttons := []Choice{}
	placement := "inline"
	if node != nil {
		if node.Data.Placement != "" {
			placement = node.Data.Placement
		}
		if node.Type == "buttons" {
			for i, b := range node.Data.Buttons {
				var url *string
				if b.URL != "" {
					v := b.URL
					url = &v
				}
				buttons = append(buttons, Choice{b.Label, b.Action, url, token + ":" + strconv.Itoa(i)})
			}
		}
	}
	if len(buttons) > 0 {
		s.Menus[token] = Menu{node.ID, buttons, placement}
		s.MenuOrder = append(s.MenuOrder, token)
	}
	return Event{"type": "message", "text": s.text(text), "buttons": buttons, "token": token, "placement": placement}
}
func (s *Session) run(id string, now int64) []Event {
	events := []Event{}
	for count := 0; id != ""; count++ {
		if count == 100 {
			s.Waiting = ""
			s.Deadline = nil
			events = append(events, Event{"type": "error", "text": "Возможный цикл: 100 переходов без ожидания пользователя", "nodeId": id})
			break
		}
		n := s.node(id)
		if n == nil {
			events = append(events, Event{"type": "error", "text": "Блок не найден", "nodeId": id})
			break
		}
		s.Current = id
		d := n.Data
		if n.Type == "text" || n.Type == "buttons" || n.Type == "input" {
			events = append(events, s.message(d.Text, n))
		}
		if n.Type == "input" {
			s.Waiting = id
			s.Deadline = nil
			if s.flag("inputTimeout", false) {
				end := now + int64(s.number("timeoutSeconds")*1000)
				s.Deadline = &end
			}
			break
		}
		if n.Type == "buttons" || n.Type == "end" {
			s.Waiting = ""
			s.Deadline = nil
			break
		}
		if n.Type == "condition" {
			left := s.Values[d.Variable]
			yes := false
			if number, ok := left.(float64); ok {
				right, _ := strconv.ParseFloat(d.Value, 64)
				switch d.Operation {
				case "eq":
					yes = number == right
				case "ne":
					yes = number != right
				case "contains":
					yes = strings.Contains(valueText(left), d.Value)
				case "gt":
					yes = number > right
				case "lt":
					yes = number < right
				}
			} else {
				switch d.Operation {
				case "eq":
					yes = valueText(left) == d.Value
				case "ne":
					yes = valueText(left) != d.Value
				case "contains":
					yes = strings.Contains(valueText(left), d.Value)
				}
			}
			output := "no"
			if yes {
				output = "yes"
			}
			id = s.next(id, output)
		} else {
			id = s.next(id, "next")
		}
	}
	return events
}
func (s *Session) Tick(now int64) []Event {
	if s.Deadline != nil && now >= *s.Deadline {
		s.Waiting = ""
		s.Deadline = nil
		return []Event{s.message(s.option("timeoutText", "Время ожидания истекло."), nil)}
	}
	return []Event{}
}
func (s *Session) Handle(event map[string]any, now int64) []Event {
	events := s.Tick(now)
	if s.flag("rateLimit", false) {
		times := []int64{}
		for _, t := range s.Times {
			if now-t < int64(s.number("rateSeconds")*1000) {
				times = append(times, t)
			}
		}
		s.Times = times
		if len(times) >= int(s.number("rateCount")) {
			if s.LastLimitNotice == nil || now-*s.LastLimitNotice >= int64(s.number("rateSeconds")*1000) {
				events = append(events, s.message("Слишком много сообщений. Попробуйте позже.", nil))
				n := now
				s.LastLimitNotice = &n
			}
			return events
		}
		s.Times = append(s.Times, now)
	}
	target := ""
	callback, _ := event["callback"].(string)
	if callback != "" {
		parts := strings.Split(callback, ":")
		index := -1
		if len(parts) == 2 {
			if parsed, err := strconv.Atoi(parts[1]); err == nil {
				index = parsed
			}
		}
		menu, ok := s.Menus[parts[0]]
		if !ok || index < 0 || index >= len(menu.Buttons) || menu.Buttons[index].Action != "transition" {
			return append(events, Event{"type": "notice", "text": "Эта кнопка больше не активна."})
		}
		target = s.next(menu.NodeID, s.node(menu.NodeID).Data.Buttons[index].ID)
	} else {
		text, _ := event["text"].(string)
		text = strings.TrimSpace(text)
		raw := ""
		if parts := strings.Fields(text); len(parts) > 0 {
			raw = mentionPattern.ReplaceAllString(parts[0], "")
		}
		cmd := raw
		if s.flag("ignoreCase", false) {
			cmd = strings.ToLower(raw)
		}
		if cmd == "/start" {
			events = append(events, s.clearMenus()...)
			s.resetValues()
			s.Waiting = ""
			s.Deadline = nil
			if s.start() == "" {
				return append(events, Event{"type": "error", "text": "Добавьте блок «Старт»", "nodeId": nil})
			}
			return append(events, s.run(s.start(), now)...)
		}
		if cmd == "/help" && s.flag("help", true) {
			commands := []string{"/start — Начать заново"}
			for _, n := range s.Project.Nodes {
				if n.Type == "command" {
					text := n.Data.Command
					if n.Data.Description != "" {
						text += " — " + n.Data.Description
					}
					commands = append(commands, text)
				}
			}
			if s.flag("cancel", true) {
				commands = append(commands, "/cancel — Отменить ввод")
			}
			return append(events, s.message(strings.Join(commands, "\n"), nil))
		}
		if cmd == "/cancel" && s.flag("cancel", true) {
			s.Waiting = ""
			s.Deadline = nil
			if s.flag("disableOldButtons", true) {
				events = append(events, s.clearMenus()...)
			}
			return append(events, s.run(s.start(), now)...)
		}
		for _, n := range s.Project.Nodes {
			if n.Type == "command" {
				name := n.Data.Command
				if s.flag("ignoreCase", false) {
					name = strings.ToLower(name)
				}
				if name == cmd {
					target = n.ID
					break
				}
			}
		}
		if target == "" {
			if strings.HasPrefix(text, "/") {
				if s.flag("unknownCommand", true) {
					events = append(events, s.message(s.option("unknownCommandText", "Неизвестная команда. Введите /help"), nil))
				}
				return events
			}
			for _, n := range s.Project.Nodes {
				if n.Type != "command" || strings.TrimSpace(n.Data.TriggerText) == "" { continue }
				phrase, candidate := strings.TrimSpace(n.Data.TriggerText), text
				if s.flag("ignoreCase", false) { phrase, candidate = strings.ToLower(phrase), strings.ToLower(candidate) }
				if candidate == phrase || (n.Data.TriggerMode == "contains" && strings.Contains(candidate, phrase)) { target = n.ID; break }
			}
			keyboard := target != ""
			for i := len(s.MenuOrder) - 1; i >= 0 && !keyboard; i-- {
				m := s.Menus[s.MenuOrder[i]]
				if m.Placement == "keyboard" {
					for j, b := range m.Buttons {
						if b.Label == text {
							target = s.next(m.NodeID, s.node(m.NodeID).Data.Buttons[j].ID)
							keyboard = true
							break
						}
					}
				}
			}
			if !keyboard && s.Waiting != "" {
				node := s.node(s.Waiting)
				d := node.Data
				value, isNumber := numeric(text)
				ok := false
				switch d.Validation {
				case "text":
					ok = text != ""
				case "number":
					ok = isNumber
				case "email":
					ok = emailPattern.MatchString(text)
				case "choice":
					for _, choice := range strings.Split(d.Choices, ",") {
						if strings.TrimSpace(choice) == text {
							ok = true
						}
					}
				}
				kind := "text"
				for _, v := range s.Project.Variables {
					if v.Name == d.Variable {
						kind = v.Type
					}
				}
				if !ok || (kind == "number" && !isNumber) {
					errorText := d.Error
					if errorText == "" {
						errorText = "Проверьте введённое значение"
					}
					events = append(events, s.message(errorText, nil))
					if s.flag("repeatQuestion", true) {
						events = append(events, s.message(d.Text, nil))
					}
					return events
				}
				if kind == "number" {
					s.Values[d.Variable] = value
				} else {
					s.Values[d.Variable] = text
				}
				target = s.next(node.ID, "next")
			} else if !keyboard {
				if s.flag("unknownText", true) {
					events = append(events, s.message(s.option("unknownTextMessage", "Не понимаю. Введите /help"), nil))
				}
				return events
			}
		}
	}
	s.Waiting = ""
	s.Deadline = nil
	if s.flag("disableOldButtons", true) {
		events = append(events, s.clearMenus()...)
	}
	return append(events, s.run(target, now)...)
}

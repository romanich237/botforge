package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

type API struct {
	Token  string
	Client *http.Client
}

func (a *API) Call(method string, data any) (map[string]any, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	response, err := a.Client.Post("https://api.telegram.org/bot"+a.Token+"/"+method, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("Нет соединения с Telegram")
	}
	defer response.Body.Close()
	var result struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 10<<20)).Decode(&result); err != nil {
		return nil, errors.New("Некорректный ответ Telegram")
	}
	if !result.OK {
		if result.Parameters.RetryAfter > 0 {
			time.Sleep(time.Duration(result.Parameters.RetryAfter) * time.Second)
		}
		return nil, fmt.Errorf("%s: %s", method, result.Description)
	}
	var object map[string]any
	if method == "getUpdates" {
		var updates []Update
		if err = json.Unmarshal(result.Result, &updates); err != nil {
			return nil, err
		}
		return map[string]any{"updates": updates}, nil
	}
	if len(result.Result) > 0 && result.Result[0] == '{' {
		err = json.Unmarshal(result.Result, &object)
	}
	return object, err
}

type Chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}
type Message struct {
	Chat Chat   `json:"chat"`
	ID   int64  `json:"message_id"`
	Text string `json:"text"`
}
type Callback struct {
	ID      string   `json:"id"`
	Data    string   `json:"data"`
	Message *Message `json:"message"`
}
type Update struct {
	ID       int64     `json:"update_id"`
	Message  *Message  `json:"message"`
	Callback *Callback `json:"callback_query"`
}
type Call func(string, any) (map[string]any, error)
type BotSession struct {
	Engine        *Session
	ChatID        int64
	Messages      map[string]any
	LastMessage   any
	LastPlacement string
	mu            sync.Mutex
	queue         []func()
	busy          bool
}

func (s *BotSession) Enqueue(task func(), callback bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if callback && s.busy && s.Engine.flag("preventDoubleClick", true) {
		return false
	}
	s.queue = append(s.queue, task)
	if !s.busy {
		s.busy = true
		go func() {
			for {
				s.mu.Lock()
				if len(s.queue) == 0 {
					s.busy = false
					s.mu.Unlock()
					return
				}
				next := s.queue[0]
				s.queue = s.queue[1:]
				s.mu.Unlock()
				next()
			}
		}()
	}
	return true
}
func (s *BotSession) Idle() bool { s.mu.Lock(); defer s.mu.Unlock(); return !s.busy }
func markup(event Event) map[string]any {
	buttons, _ := event["buttons"].([]Choice)
	rows := [][]map[string]any{}
	columns := 1
	if c, ok := event["columns"].(int); ok && c >= 1 && c <= 4 { columns = c }
	for i, b := range buttons {
		choice := map[string]any{"text": b.Label}
		if event["placement"] != "keyboard" {
			if b.Action == "url" {
				choice["url"] = b.URL
			} else {
				choice["callback_data"] = b.Callback
			}
		}
		if i%columns == 0 { rows = append(rows, []map[string]any{}) }
		rows[len(rows)-1] = append(rows[len(rows)-1], choice)
	}
	if len(buttons) > 0 {
		if event["placement"] == "keyboard" {
			return map[string]any{"keyboard": rows, "resize_keyboard": true, "one_time_keyboard": event["oneTime"] == true}
		}
		return map[string]any{"inline_keyboard": rows}
	}
	return map[string]any{"remove_keyboard": true}
}
func deliver(s *BotSession, events []Event, call Call) error {
	for _, event := range events {
		if event["type"] == "disable" {
			tokens, _ := event["tokens"].([]string)
			links, _ := event["links"].(map[string][]Link)
			for _, token := range tokens {
				if id, ok := s.Messages[token]; ok {
					rows := [][]Link{}
					for _, link := range links[token] {
						rows = append(rows, []Link{link})
					}
					if _, err := call("editMessageReplyMarkup", map[string]any{"chat_id": s.ChatID, "message_id": id, "reply_markup": map[string]any{"inline_keyboard": rows}}); err != nil {
						log.Print("Не удалось отключить старую клавиатуру")
					}
					delete(s.Messages, token)
				}
			}
			continue
		}
		if event["type"] == "notice" {
			continue
		}
		if s.Engine.flag("typing", false) {
			_, _ = call("sendChatAction", map[string]any{"chat_id": s.ChatID, "action": "typing"})
		}
		text, _ := event["text"].(string)
		if text == "" {
			text = "Сценарий завершён"
		}
		runes := []rune(text)
		for i := 0; i < len(runes); i += 4000 {
			end := i + 4000
			if end > len(runes) {
				end = len(runes)
			}
			last := end == len(runes)
			reply := map[string]any{"remove_keyboard": true}
			if last {
				reply = markup(event)
			}
			var result map[string]any
			if s.Engine.option("history", "keep") == "update" && s.LastMessage != nil && s.LastPlacement != "keyboard" && reply["keyboard"] == nil {
				rows := reply["inline_keyboard"]
				if rows == nil {
					rows = [][]any{}
				}
				result, _ = call("editMessageText", map[string]any{"chat_id": s.ChatID, "message_id": s.LastMessage, "text": string(runes[i:end]), "reply_markup": map[string]any{"inline_keyboard": rows}})
			}
			if result == nil {
				if s.Engine.option("history", "keep") == "delete" && s.LastMessage != nil {
					if _, err := call("deleteMessage", map[string]any{"chat_id": s.ChatID, "message_id": s.LastMessage}); err != nil {
						log.Print("Удаление недоступно, диалог продолжается")
					}
				}
				var err error
				result, err = call("sendMessage", map[string]any{"chat_id": s.ChatID, "text": string(runes[i:end]), "reply_markup": reply})
				if err != nil {
					return err
				}
			}
			s.LastMessage = result["message_id"]
			s.LastPlacement, _ = event["placement"].(string)
			buttons, _ := event["buttons"].([]Choice)
			if last && len(buttons) > 0 {
				token, _ := event["token"].(string)
				s.Messages[token] = s.LastMessage
			}
		}
	}
	return nil
}
func serve(api *API, project Project) error {
	webhook, err := api.Call("getWebhookInfo", map[string]any{})
	if err != nil {
		return err
	}
	if url, _ := webhook["url"].(string); url != "" {
		return errors.New("У бота установлен webhook. Отключите его перед запуском polling.")
	}
	sessions := map[int64]*BotSession{}
	var offset int64
	log.Print("Бот запущен. Для остановки нажмите Ctrl+C.")
	for {
		result, err := api.Call("getUpdates", map[string]any{"offset": offset, "timeout": 1, "allowed_updates": []string{"message", "callback_query"}})
		if err != nil {
			log.Print(err)
			time.Sleep(2 * time.Second)
			continue
		}
		updates, _ := result["updates"].([]Update)
		for _, update := range updates {
			offset = update.ID + 1
			message := update.Message
			callback := update.Callback
			if callback != nil {
				message = callback.Message
			}
			if message == nil || message.Chat.Type != "private" {
				continue
			}
			if callback != nil {
				_, _ = api.Call("answerCallbackQuery", map[string]any{"callback_query_id": callback.ID})
			}
			session := sessions[message.Chat.ID]
			if session == nil {
				session = &BotSession{Engine: NewSession(project, ""), ChatID: message.Chat.ID, Messages: map[string]any{}}
				sessions[message.Chat.ID] = session
			}
			event := map[string]any{"text": message.Text}
			if callback != nil {
				event = map[string]any{"callback": callback.Data}
			}
			session.Enqueue(func() {
				if channel, ok := project.Behavior["subscriptionChat"].(string); ok && channel != "" {
					member, err := api.Call("getChatMember", map[string]any{"chat_id": channel, "user_id": message.Chat.ID})
					status, _ := member["status"].(string)
					isMember, _ := member["is_member"].(bool)
					if err != nil || !(status == "creator" || status == "administrator" || status == "member" || (status == "restricted" && isMember)) {
						if err != nil { log.Print("Не удалось проверить подписку: ", err) }
						if callback == nil {
							messageText, _ := project.Behavior["subscriptionMessage"].(string)
							if messageText == "" { messageText = "Подпишитесь на канал и повторите попытку." }
							_, _ = api.Call("sendMessage", map[string]any{"chat_id": message.Chat.ID, "text": messageText})
						}
						return
					}
				}
				if err := deliver(session, session.Engine.Handle(event, time.Now().UnixMilli()), api.Call); err != nil {
					log.Print(err)
				}
				if callback == nil && session.Engine.flag("deleteUser", false) {
					if _, err := api.Call("deleteMessage", map[string]any{"chat_id": message.Chat.ID, "message_id": message.ID}); err != nil {
						log.Print("Нет возможности удалить сообщение пользователя")
					}
				}
			}, callback != nil)
		}
		for _, s := range sessions {
			if s.Idle() {
				s.Enqueue(func() {
					if err := deliver(s, s.Engine.Tick(time.Now().UnixMilli()), api.Call); err != nil {
						log.Print(err)
					}
				}, false)
			}
		}
	}
}
func main() {
	if content, err := os.ReadFile(".env"); err == nil && os.Getenv("BOT_TOKEN") == "" {
		for _, line := range strings.Split(string(content), "\n") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 && strings.TrimSpace(parts[0]) == "BOT_TOKEN" {
				_ = os.Setenv("BOT_TOKEN", strings.Trim(strings.TrimSpace(parts[1]), "\"'"))
			}
		}
	}
	token := os.Getenv("BOT_TOKEN")
	if !regexp.MustCompile(`^[0-9]+:[A-Za-z0-9_-]+$`).MatchString(token) {
		log.Fatal("Укажите BOT_TOKEN в локальном .env")
	}
	content, err := os.ReadFile("project.json")
	if err != nil {
		log.Fatal("Не удалось прочитать project.json")
	}
	var project Project
	if json.Unmarshal(content, &project) != nil {
		log.Fatal("Некорректный project.json")
	}
	api := &API{Token: token, Client: &http.Client{Timeout: 35 * time.Second}}
	if err := serve(api, project); err != nil {
		log.Fatal(err)
	}
}

# Production deployment

Pushes to `main` run checks and deploy BotForge to Ubuntu over SSH.

## GitHub Actions secrets

Configure these repository secrets:

- `SSH_HOST`: server hostname or IP address.
- `SSH_USER`: unprivileged deployment user.
- `SSH_PRIVATE_KEY`: private half of a dedicated deployment SSH key.
- `SSH_KNOWN_HOSTS`: trusted host-key line produced by `ssh-keyscan -H SERVER` and
  verified against the server's own SSH host-key fingerprint.
- `SSH_PORT`: optional; defaults to `22`.
- `DEPLOY_PATH`: optional; defaults to `/opt/botforge`.

Do not put application secrets in GitHub. Production values live only on the
server in `/opt/botforge/shared/.env`. The first deployment creates that file
from `.env.example`; edit it on the server and rerun the workflow.

## One-time Ubuntu preparation

Install Node.js 24 and give the deployment user ownership of the target:

```sh
sudo mkdir -p /opt/botforge
sudo chown -R "$USER":"$USER" /opt/botforge
node --version
npm --version
```

The workflow installs PM2 if it is missing. If global npm installation needs
administrator rights, allow the deployment user to run only the required npm
installation without a password, or install PM2 once yourself:

```sh
sudo npm install --global pm2
```

After the first successful deployment, enable restart after reboot:

```sh
pm2 startup
# Run the exact command printed by PM2, then:
pm2 save
```

The web process listens on `127.0.0.1:3000`; expose it through Nginx or another
reverse proxy. Keep `/opt/botforge/shared` in server backups.

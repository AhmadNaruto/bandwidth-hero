# ⚠️ SYSTEMD EXECUTION REQUIRED

## IMPORTANT: Server MUST Run via systemd

This server is configured to **ONLY run via systemd** in production mode.

### Why systemd Only?

1. **Process Management** - Automatic restarts on failure
2. **Logging** - Centralized logging via journalctl
3. **Resource Limits** - CPU, memory, and file descriptor limits
4. **Security** - Sandboxing and privilege restrictions
5. **Health Monitoring** - Built-in health checks and recovery

### How to Start/Stop/Restart

```bash
# Start the server
sudo systemctl start bandwidth-hero

# Stop the server
sudo systemctl stop bandwidth-hero

# Restart the server
sudo systemctl restart bandwidth-hero

# Check status
sudo systemctl status bandwidth-hero

# View logs
sudo journalctl -u bandwidth-hero -f
```

### What Happens If You Try to Run Manually?

```bash
# ❌ This will FAIL in production mode
NODE_ENV=production bun run src/index.ts

# Error output:
{"level":"ERROR","message":"Server must be run via systemd in production. Use: sudo systemctl start bandwidth-hero"}
```

### How the Guard Works

The server checks for systemd environment variables:

```typescript
const isSystemdManaged =
  process.env.INVOCATION_ID ||
  process.env.JOURNAL_STREAM ||
  process.env.SYSTEMD_EXEC_PID;

if (isProduction && !isSystemdManaged) {
  logger.error("Server must be run via systemd...");
  process.exit(1);
}
```

When run via systemd, these variables are automatically set.

### Development Mode

For local development, you CAN run manually with:

```bash
# ✅ This works (development mode)
NODE_ENV=development bun run src/index.ts

# Or with the dev script
bun run dev
```

### Service Configuration

Location: `/etc/systemd/system/bandwidth-hero.service`

Key settings:
- `ExecStart`: Points to `bun run --env-file=.env src/index.ts`
- `Restart=always`: Auto-restart on crashes
- `Environment=NODE_ENV=production`: Forces production mode

### Troubleshooting

**Server won't start?**
```bash
# Check service status
sudo systemctl status bandwidth-hero

# View detailed logs
sudo journalctl -u bandwidth-hero -n 50 --no-pager

# Check if port is in use
sudo lsof -i :8080

# Reload systemd after config changes
sudo systemctl daemon-reload
```

**Accidentally killed the process?**
```bash
# systemd will auto-restart it!
sudo systemctl status bandwidth-hero
```

**Need to change configuration?**
```bash
# Edit .env file
sudo nano /home/ubuntu/bandwidth-hero-bun/.env

# Restart to apply changes
sudo systemctl restart bandwidth-hero
```

### Remember

> 🚨 **NEVER run manually in production!** Always use:
> ```bash
> sudo systemctl [start|stop|restart|status] bandwidth-hero
> ```

### Quick Reference

| Action | Command |
|--------|---------|
| Start | `sudo systemctl start bandwidth-hero` |
| Stop | `sudo systemctl stop bandwidth-hero` |
| Restart | `sudo systemctl restart bandwidth-hero` |
| Status | `sudo systemctl status bandwidth-hero` |
| Logs (live) | `sudo journalctl -u bandwidth-hero -f` |
| Logs (last 50) | `sudo journalctl -u bandwidth-hero -n 50` |
| Reload config | `sudo systemctl daemon-reload` |

---

**This server is managed by systemd. Do not bypass systemd!**

#!/bin/zsh
# 课堂互动乐园 - 启动脚本（服务器 + 公网隧道）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd /Users/shunzhechangda/classroom-pet || exit 1

# 清理旧进程（幂等，可重复运行）
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

# 启动后端服务器
node server.js > server.log 2>&1 &

# 启动公网隧道（主：cloudflared，备：localhost.run）
./bin/cloudflared tunnel --no-autoupdate --url http://localhost:8787 > tunnel.log 2>&1 &
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8787 nokey@localhost.run > lhr.log 2>&1 &

# 等待隧道建立并记录公网链接
sleep 12
URL1=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" tunnel.log | head -1)
URL2=$(grep -oE "https://[a-z0-9]+\.lhr\.life" lhr.log | head -1)
echo "主链接: $URL1" > public-url.txt
echo "备用链接: $URL2" >> public-url.txt
echo "$(date '+%F %T') $URL1 | $URL2" >> start-history.log
echo "✅ 课堂互动乐园已启动"
echo "🔗 主链接: $URL1"
echo "🔗 备用链接: $URL2"

# 保持前台运行（配合 launchd KeepAlive）
wait

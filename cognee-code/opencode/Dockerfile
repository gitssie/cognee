FROM 172.16.17.231:5000/opencode:dev

# 配置文件 → /root/.config/opencode/
COPY opencode.json /root/.config/opencode/opencode.json
# COPY plugins/   /root/.config/opencode/plugins/

# auth.json 不在镜像里 → 运行时由 /root/.local/share/opencode/auth.json 注入

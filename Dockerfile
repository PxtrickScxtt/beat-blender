FROM node:20-bullseye

# Instalar Python, FFmpeg y dependencias necesarias para yt-dlp
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Establecer el directorio de trabajo
WORKDIR /app

# Copiar el package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias necesarias para server.js (express, cors)
RUN npm install

# Copiar el código fuente del servidor
COPY server.js ./

# Exponer el puerto
EXPOSE 3001

# Iniciar el proxy
CMD ["node", "server.js"]

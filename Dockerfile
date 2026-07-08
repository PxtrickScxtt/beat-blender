FROM node:20-bookworm

# Instalar Python, FFmpeg y yt-dlp via pip (siempre la ultima version)
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl && \
    pip3 install -U yt-dlp --break-system-packages

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

# Actualizar yt-dlp al arrancar y luego iniciar el servidor
CMD sh -c "pip3 install -U yt-dlp --break-system-packages --quiet && node server.js"

FROM node:20-bookworm

WORKDIR /app

# Instalar dependencias de Node
COPY package*.json ./
RUN npm install

# Copiar el resto del código (incluyendo Angular)
COPY . .

# Construir el frontend de Angular para producción
RUN npm run build

EXPOSE 3001

# Iniciar el servidor Express que servirá la API y el frontend compilado
CMD ["node", "server.js"]

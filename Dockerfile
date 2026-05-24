FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /data/uploads
EXPOSE 3029
ENV DATA_DIR=/data
CMD ["node", "server.js"]

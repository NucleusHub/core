FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3005
CMD ["sh", "-c", "npm install && node --watch index.js"]

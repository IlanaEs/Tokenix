FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]

FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Ensure entrypoint is available at root and executable in the Linux image
# Copy the script to /entrypoint.sh so docker-compose can always call it
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8545

ENTRYPOINT ["/entrypoint.sh"]

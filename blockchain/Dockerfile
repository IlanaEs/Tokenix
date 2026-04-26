FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Ensure entrypoint is available at root and executable in the Linux image
# Copy the script to /entrypoint.sh so docker-compose can always call it
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8545

CMD ["/bin/sh", "-c", "./entrypoint.sh"]

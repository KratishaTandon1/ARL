FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose the API port
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start"]

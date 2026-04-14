FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["node", "src/app.js"]

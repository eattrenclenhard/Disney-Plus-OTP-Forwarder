# Dockerfile
FROM node:23-bullseye

# Set the working directory
WORKDIR /usr/src/app

# Install tzdata to handle timezones
RUN apt-get update && apt-get install -y tzdata
ENV TZ=UTC

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code
COPY ./app.js .

# Expose the port the app runs on (optional, since we won't map it)
EXPOSE 3000

# Command to run the application
CMD ["node", "app.js"]
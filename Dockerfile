# Same version as @playwright/test in package.json, so browsers and screenshots match.
# Update both together. Visual baselines must be generated INSIDE this image.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV CI=true \
    HEADLESS=true \
    NODE_ENV=test

# Install dependencies first: this layer is cached until package*.json change
COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci --ignore-scripts && chown -R pwuser:pwuser /app

COPY --chown=pwuser:pwuser . .

# The image ships a non-root user; browsers are already installed for it
USER pwuser

# Secrets are passed at run time (--env-file .env or -e), never baked into the image
CMD ["npm", "run", "test:regression"]

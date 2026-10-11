# ─── STAGE 1: Build the Angular Application ───
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy application source code
COPY . .

# Compile Angular production bundle
RUN npm run build -- --configuration production

# ─── STAGE 2: Serve Production Assets via Nginx ───
FROM nginx:alpine

# Copy custom Nginx configuration with SPA routing fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the Angular build to a temporary directory
COPY --from=builder /app/dist/price-tracker/browser/ /tmp/angular/

# Remove Nginx's default page and prepare the Angular entry point
RUN rm -rf /usr/share/nginx/html/* \
    && cp -a /tmp/angular/. /usr/share/nginx/html/ \
    && if [ ! -f /usr/share/nginx/html/index.html ] && [ -f /usr/share/nginx/html/index.csr.html ]; then \
         mv /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html; \
       fi \
    && rm -rf /tmp/angular
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

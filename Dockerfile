# Imagem única (dev-friendly). O foco do desafio é o comportamento do sistema,
# não a otimização do build — um multi-stage entra depois se necessário.
FROM oven/bun:1

WORKDIR /app

# Dependências primeiro, para aproveitar o cache de camadas.
COPY package.json ./
COPY bun.lock* ./
RUN bun install

# Código.
COPY . .

EXPOSE 3000

# O comando real (migrations + start) é definido no docker-compose.yml.
CMD ["bun", "run", "start"]

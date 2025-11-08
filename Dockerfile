FROM denoland/deno:alpine

WORKDIR /app

COPY . .

RUN deno cache main.ts
EXPOSE 7000

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]

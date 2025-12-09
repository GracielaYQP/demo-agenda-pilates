import { webcrypto as crypto } from 'crypto';
Object.defineProperty(globalThis, 'crypto', { value: crypto });
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Dominios permitidos
  const allowedOrigins = [
    'http://localhost:4200',        // Angular dev
    'http://127.0.0.1:4200',        // alternativa
    'https://luciacarlettapilates.com', 
  ];

  app.enableCors({
    origin: [
      'https://luciacarlettapilates.com',
      'http://localhost:4200',
      'http://127.0.0.1:4200',
    ],
    methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
    credentials: false,     // poné true SOLO si vas a usar cookies/sesión
    maxAge: 86400,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.listen(process.env.PORT || 3000, '0.0.0.0');
}
bootstrap();

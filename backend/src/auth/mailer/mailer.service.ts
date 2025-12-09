import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter = nodemailer.createTransport({
    service: 'gmail', // o tu proveedor (ej: outlook, mailtrap, etc.)
    auth: {
      user: 'TU_CORREO@gmail.com',
      pass: 'TU_CONTRASEÑA_O_APP_PASSWORD',
    },
  });

  async sendMail(options: { to: string; subject: string; html: string }) {
    await this.transporter.sendMail({
      from: '"Tu Estudio Pilates" <TU_CORREO@gmail.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
  }
}


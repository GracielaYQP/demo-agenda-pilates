import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly token = process.env.WHATSAPP_TOKEN!;
  private readonly phoneId = process.env.WHATSAPP_PHONE_ID!;
  private readonly url = `https://graph.facebook.com/v20.0/${this.phoneId}/messages`;

  constructor(private readonly http: HttpService) {}

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private formatPhoneNumber(numero: string): string {
    // Elimina todo lo que no sea dígito
    const clean = numero.replace(/\D/g, '');

    // Si ya empieza con 54 (código de país), lo uso tal cual
    if (clean.startsWith('54')) {
      return clean;
    }

    // Si no, asumo que es un número argentino y le agrego 54 delante
    return `54${clean}`;
  }

  // ✉️ Enviar texto genérico (usado dentro de ventana 24hs o para pruebas)

  async sendText(to: string, body: string) {
    const toE164 = this.formatPhoneNumber(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'text',
      text: { body },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(this.url, payload, { headers: this.getHeaders() }),
      );
      this.logger.log(`✅ Mensaje de texto enviado a ${toE164}`);
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ Error al enviar texto a ${toE164}: ${error?.response?.data?.error?.message || error.message}`,
      );
      throw error;
    }
  }

  // ---------------------------
  // 💳 Aviso de vencimiento de plan (texto libre)
  // ---------------------------
  async sendAvisoVencimiento(numero: string, nombre: string, planType: string) {
    const message =
      `¡Hola, ${nombre}! \n\n` +
      `Te escribo para recordarte que tu plan ${planType} de pilates está por finalizar.\n\n` +
      `Para continuar con tus clases sin interrupciones, por favor, realiza el pago de tu nuevo plan.\n` +
      `¡Muchas gracias!`;

    return this.sendText(numero, message);
  }

   async sendTemplatePlanPorVencer(to: string, nombre: string, planType: string) {
    const toE164 = this.formatPhoneNumber(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'template',
      template: {
        name: 'plan_por_vencer',
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: nombre || 'alumno/a' },             // {{1}}
              { type: 'text', text: planType || 'tu plan actual' },     // {{2}}
              { type: 'text', text: 'Lucía Carletta Estudio Pilates' }, // {{3}}
            ],
          },
        ],
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(this.url, payload, { headers: this.getHeaders() }),
      );
      this.logger.log(`✅ Template plan_por_vencer enviado a ${toE164}`);
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ Error al enviar template a ${toE164}: ${
          error?.response?.data?.error?.message || error.message
        }`,
      );
      throw error;
    }
  }

  async sendTemplatePlanVencido(to: string, nombre: string, planType: string) {
    const toE164 = this.formatPhoneNumber(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'template',
      template: {
        name: 'plan_vencido_v3',         
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: nombre || 'alumno/a' },             // {{1}}
              { type: 'text', text: planType || 'tu plan actual' },     // {{2}}
              { type: 'text', text: 'Lucía Carletta Estudio Pilates' }, // {{3}}
            ],
          },
        ],
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(this.url, payload, { headers: this.getHeaders() }),
      );
      this.logger.log(`✅ Template plan_vencido_v3 enviado a ${toE164}`);
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ Error al enviar template plan_vencido_v3 a ${toE164}: ${
          error?.response?.data?.error?.message || error.message
        }`,
      );
      throw error;
    }
  }

  async sendTemplateClasesSuspendidas(
    to: string,
    nombre: string,
    fechaLarga: string,
    tramo: string,
    motivo: string,
  ) {
    const toE164 = this.formatPhoneNumber(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'template',
      template: {
        name: 'clase_suspendida',        // 👈 mismo nombre que en Meta
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: nombre || 'alumno/a' },  // {{1}}
              { type: 'text', text: fechaLarga },            // {{2}}
              { type: 'text', text: tramo || '' },           // {{3}}
              { type: 'text', text: motivo || 'motivos personales' }, // {{4}}
            ],
          },
        ],
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(this.url, payload, { headers: this.getHeaders() }),
      );
      this.logger.log(`✅ Template clase_suspendida enviado a ${toE164}`);
      return data;
    } catch (error: any) {
      this.logger.error(
        `❌ Error al enviar template clase_suspendida a ${toE164}: ${
          error?.response?.data?.error?.message || error.message
        }`,
      );
      throw error;
    }
  }


}


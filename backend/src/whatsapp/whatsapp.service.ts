import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly http: HttpService, private readonly config: ConfigService,) {}

   private get token() {
    return this.config.get<string>('WHATSAPP_TOKEN') || '';
  }

  private get phoneId() {
    return this.config.get<string>('WHATSAPP_PHONE_ID') || '';
  }

  private get url() {
    return `https://graph.facebook.com/v20.0/${this.phoneId}/messages`;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private formatPhoneNumber(numero: string): string {
    let n = String(numero ?? '').trim().replace(/\D/g, '');

    if (!n) {
      throw new Error('Teléfono vacío');
    }

    // Quitar prefijo 00 internacional
    if (n.startsWith('00')) {
      n = n.slice(2);
    }

    // =========================
    // ARGENTINA CON 54
    // =========================
    if (n.startsWith('54')) {
      // Ya viene como 549... => OK
      if (n.startsWith('549')) {
        if (n.length < 13) throw new Error(`Teléfono AR inválido/incompleto: ${n}`);
        return n;
      }

      // 54 + area + 15 + numero => sacar 15 y agregar 9
      n = n.replace(/^54(\d{2,4})15(\d{6,8})$/, '54$1$2');

      const out = '549' + n.slice(2);
      if (out.length < 13) throw new Error(`Teléfono AR inválido/incompleto: ${out}`);
      return out;
    }

    // =========================
    // ARGENTINA LOCAL SIN 54
    // Ej: 3517152375 / 1134567890 / 3492... / 0351...
    // =========================
    if (n.startsWith('0')) {
      n = n.slice(1);
    }

    const pareceArgentino =
      n.startsWith('11') ||
      n.startsWith('15') ||
      n.startsWith('2') ||
      n.startsWith('3');

    if (pareceArgentino) {
      // sacar 15 si vino en formato viejo local
      if (n.length === 11 || n.length === 12) {
        n = n.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
      }

      const out = '549' + n;
      if (out.length < 13) throw new Error(`Teléfono AR inválido/incompleto: ${out}`);
      return out;
    }

    // =========================
    // SOLO ARGENTINA
    // =========================
    throw new Error(`Formato de teléfono argentino no reconocido: ${n}`);
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
        const status = error?.response?.status;
        const data = error?.response?.data;

        this.logger.error(
          `❌ WhatsApp API error (status ${status}) to=${toE164} url=${this.url}`,
        );

        // MUY IMPORTANTE: esto te muestra el error real de Meta
        this.logger.error('WHATSAPP_DEBUG_JSON_START');
        this.logger.error(JSON.stringify(data ?? null, null, 2));
        this.logger.error('WHATSAPP_DEBUG_JSON_END');

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
      this.logger.log(`✅ Template plan_vencido_v3 enviado a ${toE164}`);
      return data;
      } catch (error: any) {
        const status = error?.response?.status;
        const data = error?.response?.data;

        this.logger.error(
          `❌ WhatsApp API error (status ${status}) to=${toE164} url=${this.url}`,
        );

        // MUY IMPORTANTE: esto te muestra el error real de Meta
        this.logger.error('WHATSAPP_DEBUG_JSON_START');
        this.logger.error(JSON.stringify(data ?? null, null, 2));
        this.logger.error('WHATSAPP_DEBUG_JSON_END');

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
        name: 'clase_suspendida',       
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: nombre || 'alumno/a' },  // {{1}}
              { type: 'text', text: fechaLarga },            // {{2}}
              { type: 'text', text: (tramo?.trim() || 'todo el día') },           // {{3}}
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
        const status = error?.response?.status;
        const data = error?.response?.data;

        this.logger.error(
          `❌ WhatsApp API error (status ${status}) to=${toE164} url=${this.url}`,
        );

        // MUY IMPORTANTE: esto te muestra el error real de Meta
        this.logger.error('WHATSAPP_DEBUG_JSON_START');
        this.logger.error(JSON.stringify(data ?? null, null, 2));
        this.logger.error('WHATSAPP_DEBUG_JSON_END');

        throw error;
      }

  }

  async sendTemplateResetPassword(to: string, nombre: string, token: string) {
    const toE164 = this.formatPhoneNumber(to);

    const payload = {
      messaging_product: 'whatsapp',
      to: toE164,
      type: 'template',
      template: {
        name: 'reset_password', // <- exacto
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: nombre || 'alumno/a' }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: token }],
          },
        ],
      },
    };

    const { data } = await firstValueFrom(
      this.http.post(this.url, payload, { headers: this.getHeaders() }),
    );
    this.logger.log(`✅ Template reset enviado a ${toE164}`);
    return data;
  }


}


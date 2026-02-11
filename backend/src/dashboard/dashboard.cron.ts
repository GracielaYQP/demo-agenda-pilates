import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DashboardService } from './dashboard.service';

@Injectable()
export class DashboardCron {
  private readonly logger = new Logger(DashboardCron.name);
  constructor(private readonly svc: DashboardService) {}

  // Todos los días 09:00 (zona Córdoba)
  @Cron('0 0 9 * * *', { timeZone: 'America/Argentina/Cordoba' })
  async enviarRecordatorios() {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;
    if (hoy.getDate() < 11) return;

    this.logger.log(`Notificando deudores ${anio}-${mes}`);
    const r = await this.svc.notificarDeudoresWhatsApp(anio, mes);
    this.logger.log(`Enviados: ${r.enviados}`);
  }
}

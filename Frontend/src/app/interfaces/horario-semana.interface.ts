import { Reserva } from './reserva.interface';

export interface HorarioSemana {
  id: number;         
  idHorario?: number;
  fecha: string;               
  dia: string;                 
  hora: string;               
  nivel: string;               
  totalReformers: number;

  // Pueden venir del back legacy, por eso los dejamos opcionales:
  reformersReservados?: number;
  reformersDisponibles?: number;

  // Bloqueos administrados manualmente
  blockedReformers?: number;

  // Flags por usuario
  reservadoPorUsuario?: boolean;
  canceladoPorUsuario?: boolean;

  // Lista de reservas (si el back las adjunta en el horario)
  reservas?: Reserva[];
}


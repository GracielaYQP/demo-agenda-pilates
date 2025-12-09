export interface Reserva {
  id: number;                 // id de la reserva (activo)
  nombre: string;
  apellido: string;

  // Opcionales (por si tu back los expone):
  tipo?: 'automatica' | 'recuperacion' | 'suelta';
  estado?: string;            // 'RESERVADO' | 'CANCELADA' ...
  automatica?: boolean;
  cancelada?: boolean;

  // A veces llegan anidados:
  usuario?: {
    id: number;
    nombre: string;
    apellido: string;
  };

  // Para endpoints de “reservas de la semana” (índice):
  horarioId?: number;         // id del horario al que pertenece
  fechaTurno?: string;        // 'YYYY-MM-DD'
}

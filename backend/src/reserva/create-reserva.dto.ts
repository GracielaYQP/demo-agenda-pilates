import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional } from 'class-validator';
export type TipoReserva = 'automatica' | 'recuperacion' | 'suelta';
export class CreateReservaDto {
  @IsDateString()
  @IsNotEmpty()
  fechaTurno!: string;

  @IsOptional()
  @IsBoolean()
  automatica?: boolean;

  @IsOptional()
  @IsIn(['automatica', 'recuperacion', 'suelta'])
  tipo?: TipoReserva;
}

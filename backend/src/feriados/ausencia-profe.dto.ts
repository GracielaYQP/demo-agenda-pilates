import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { TipoAusencia } from './ausencia-profe.types';

export class CreateAusenciaDto {
  @IsDateString()
  fecha!: string;

  @IsIn(['dia', 'manana', 'tarde', 'horario'])
  tipo!: TipoAusencia;

  @IsOptional() @IsString()
  hora?: string;

  @IsOptional() @IsString()
  motivo?: string;
}

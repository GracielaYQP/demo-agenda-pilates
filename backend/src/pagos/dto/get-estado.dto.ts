import { IsInt, IsIn, IsOptional, IsString, Min, Max, IsPositive } from 'class-validator';

export class EstadoPagoDto {
  @IsInt() userId!: number;
  @IsInt() @Min(1) @Max(12) mes!: number;
  @IsInt() @Min(2000) @Max(2100) anio!: number;
  isPago!: boolean;
  pago?: any;
}
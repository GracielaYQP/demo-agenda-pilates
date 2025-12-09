import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export type PlanTipo = 'suelta' | '4' | '8' | '12';

export class UpsertValorPlanDto {
  @IsEnum(['suelta','4','8','12'])
  tipo!: PlanTipo;

  @IsInt()
  @Min(0)
  precioARS!: number;

  @IsBoolean()
  visible!: boolean;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

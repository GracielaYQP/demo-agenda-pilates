import { Entity, PrimaryGeneratedColumn, Column, Unique, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type PlanTipo = 'suelta' | '4' | '8' | '12';

@Entity('valor_planes')
@Unique('u_tipo', ['tipo'])
export class ValorPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  // 'suelta' | '4' | '8' | '12'
  @Column({ type: 'enum', enum: ['suelta','4','8','12'] })
  tipo!: PlanTipo;

  // precio en ARS (entero)
  @Column({ type: 'int' })
  precioARS!: number;

  // visible al público (PlanesComponent)
  @Column({ type: 'bool', default: true })
  visible!: boolean;

  // opcional: breve texto (ej. promo)
  @Column({ type: 'varchar', length: 255, nullable: true })
  descripcion?: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}

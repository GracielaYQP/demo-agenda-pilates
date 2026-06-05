import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('ciclos_asistencia')
@Index(['userId', 'cicloInicio'])
export class CiclosAsistencia {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column({ type: 'date' })
  cicloInicio!: string;

  @Column({ type: 'date' })
  cicloFin!: string;

  @Column({ type: 'date' })
  finVentana!: string;

  @Column({ type: 'date', nullable: true })
  finReal!: string | null;

  @Column({ type: 'int', default: 0 })
  planMax!: number;

  @Column({ type: 'int', default: 0 })
  asistidas!: number;

  @Column({ type: 'int', default: 0 })
  recuperadas!: number;

  @Column({ type: 'int', default: 0 })
  usadasALaFecha!: number;

  @Column({ type: 'int', default: 0 })
  canceladas!: number;

  @Column({ type: 'int', default: 0 })
  canceladasAlumno!: number;

  @Column({ type: 'int', default: 0 })
  cerrado!: number;

  @Column({ type: 'int', default: 0 })
  derechoRecuperacion!: number;

  @Column({ type: 'int', default: 0 })
  saldoRecuperacion!: number;

  @Column({ type: 'int', default: 0 })
  recuperacionesReservadas!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasAsistidas!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasRecuperadas!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasRecupReservadas!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasCanceladas!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasSueltas!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fechasCerrado!: string[];

  @Column({ type: 'boolean', default: false })
  excedePlan!: boolean;

  @Column({ type: 'boolean', default: false })
  completo!: boolean;

  @Column({ type: 'boolean', default: true })
  abierto!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'abierto' })
  motivoCierre!: string;
}
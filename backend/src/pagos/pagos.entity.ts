import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Unique, CreateDateColumn, UpdateDateColumn, Index, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('pagos')
@Index('i_user_ciclo', ['userId','cicloInicio','cicloFin'])
@Unique('u_user_ciclo', ['userId','cicloInicio','cicloFin'])
export class Pago {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  // ✅ NUEVO: pago asociado al ciclo (ventana de clases del plan)
  @Column({ type: 'date' })
  cicloInicio!: string; // YYYY-MM-DD

  @Column({ type: 'date' })
  cicloFin!: string;    // YYYY-MM-DD

  // (opcional) mantener mes/anio solo para compatibilidad/historial viejo
  @Column({ type: 'int', nullable: true })
  mes!: number | null;

  @Column({ type: 'int', nullable: true })
  anio!: number | null;

  @Column({ type: 'enum', enum: ['suelta','4','8','12'] })
  planTipo!: 'suelta'|'4'|'8'|'12';

  @Column({ type: 'int' })
  montoARS!: number;

  @Column({ type: 'timestamptz', nullable: true })
  fechaPago!: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  metodo?: 'efectivo'|'transferencia'|'mercado_pago'|'otro';

  @Column({ type: 'text', nullable: true })
  notas?: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}

import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Unique, CreateDateColumn, UpdateDateColumn, Index, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('pagos')
@Unique('u_user_mes_anio', ['userId', 'mes', 'anio'])
@Index('i_anio_mes', ['anio','mes'])
@Index('i_user_anio_mes', ['userId','anio','mes'])

export class Pago {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'int' })   // 1..12
  mes!: number;

  @Column({ type: 'int' })   // 2025
  anio!: number;

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

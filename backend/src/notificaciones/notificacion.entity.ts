import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

@Entity('notificaciones')
@Unique('u_notif_usuario_tipo_ciclo', ['usuarioId','tipo','cicloInicio','cicloFin'])
@Index('i_notif_usuario', ['usuarioId'])
export class Notificacion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuarioId!: number;

  @Column({ type: 'varchar', length: 40 })
  tipo!: string; // 'plan_por_vencer' | 'plan_vencido_v3' etc.

  @Column({ type: 'date' })
  cicloInicio!: string;

  @Column({ type: 'date' })
  cicloFin!: string;

  @Column({ type: 'date', nullable: true })
  semanaInicio!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

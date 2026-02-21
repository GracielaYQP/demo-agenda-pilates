import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index } from 'typeorm';

@Entity('notificaciones_cierre')
@Unique('u_cierre_usuario_fecha_tipo_hora', ['usuarioId', 'fecha', 'tipoCierre', 'hora'])
@Index('i_cierre_usuario', ['usuarioId'])
@Index('i_cierre_fecha', ['fecha'])
export class NotificacionCierre {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuarioId!: number;

  @Column({ type: 'date' })
  fecha!: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 10 })
  tipoCierre!: 'dia' | 'manana' | 'tarde' | 'horario';

  // 🔑 nunca null → clave real de dedupe
  @Column({ type: 'varchar', length: 10 })
  hora!: string; // '18:00' | 'dia' | 'manana' | 'tarde'

  @CreateDateColumn()
  createdAt!: Date;
}


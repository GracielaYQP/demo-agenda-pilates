import { Reserva } from '../reserva/reserva.entity';
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  dni!: string;

  @Column()
  nombre!: string;

  @Column()
  apellido!: string;

  @Column({ default: 'Básico' })
  nivel!: string;

  @Column({ type: 'enum', enum: ['0', '4', '8', '12'], default: '4' })
  planMensual!: '0' |'4' | '8' | '12';

  @Column({ type: 'int', default: 0 })
  asistenciasDelMes!: number;

  @Column({ unique: true })
  telefono!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ default: 'alumno' })
  rol!: string;
    
  @Column({ default: true })
  activo!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column('varchar', { nullable: true })
  resetToken?: string | null;

  @Column('timestamp', { nullable: true })
  resetTokenExpiry?: Date | null;

  @OneToMany(() => Reserva, reserva => reserva.usuario)
  reservas!: Reserva[]; 

  @Column({ default: false })
  esDemo!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  demoDesde!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  demoHasta!: Date | null;


}




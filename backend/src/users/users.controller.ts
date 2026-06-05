import { Controller, Post, Body, Param, Patch, Get, NotFoundException, UseGuards, BadRequestException, Req, Query, InternalServerErrorException } from '@nestjs/common';
import { UsersService } from './users.service';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './user.entity';
import { ILike, Repository } from 'typeorm';
import { CreateUserDto } from './user.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';


@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(User)
    private userRepository: Repository<User>
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @Post()
  create(@Req() req: any, @Body() dto: CreateUserDto) {
    const creatorRole = String(req.user?.rol ?? '').toLowerCase();
    return this.usersService.create(dto, creatorRole);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @Get("/obtenerListadoUsuarios")
    obtenerListadoUsuarios(){
        return this.usersService.obtenerListadoUsuarios();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch("/modificarUsuario/:id")
  update(@Param('id') id: string, @Body() body: any) {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new BadRequestException('❌ ID inválido');
    }
    
    // Opcional: Filtrar campos permitidos
    const camposPermitidos = ['nombre', 'apellido', 'dni', 'telefono', 'email', 'nivel', 'planMensual'];
    const dataFiltrada = Object.keys(body)
      .filter(key => camposPermitidos.includes(key))
      .reduce((acc, key) => {
        acc[key] = body[key];
        return acc;
      }, {} as any);

    return this.usersService.update(userId, dataFiltrada);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch('/inactivar/:id')
    inactivarUsuario(@Param('id') id: number) {
      return this.usersService.inactivarUsuario(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('buscar')
  async buscarPorNombreYApellido(
    @Query('nombre') nombre: string,
    @Query('apellido') apellido: string
  ) {
    console.log('🔍 Buscando usuario:', { nombre, apellido });

    if (!nombre || !apellido) {
      throw new BadRequestException('Faltan nombre o apellido');
    }

    try {
      const user = await this.userRepository.findOne({
        where: {
          nombre: ILike(nombre.trim()),
          apellido: ILike(apellido.trim()),
        },
      });

      if (!user) {
        throw new NotFoundException(`No se encontró un usuario con nombre ${nombre} y apellido ${apellido}`);
      }

      return user;
    } catch (error) {
      console.error('🔥 Error al buscar usuario:', error);
      throw new InternalServerErrorException('Error en la búsqueda de usuario');
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('/:id')
    async findById(@Param('id') id: number) {
    return this.usersService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('telefono/:telefono')
  async buscarPorTelefono(@Param('telefono') telefono: string) {
    const user = await this.userRepository.findOneBy({ telefono });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch('reactivar/:id')
  async reactivarUsuario(@Param('id') id: number) {
    return this.usersService.actualizarEstado(id, true); // true = activar
  }


}

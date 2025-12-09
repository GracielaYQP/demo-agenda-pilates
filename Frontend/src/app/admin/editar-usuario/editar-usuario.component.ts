import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';

interface Usuario {
  id: number;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string;
  email: string;
  nivel: string;
  planMensual: string;
}

@Component({
  standalone: true,
  selector: 'app-editar-usuario',
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './editar-usuario.component.html',
  styleUrls: ['./editar-usuario.component.css'  ],
})
export class EditarUsuarioComponent implements OnInit {
  usuario: Usuario = {
    id: 0,
    nombre: '',
    apellido: '',
    dni: '',
    telefono: '',
    email: '',
    nivel: '',
    planMensual: ''  
  };

  modalVisible: boolean = false;
  mensajeModal: string = '';
  esError: boolean = false;
  cargando = false;

  private api = environment.apiUrl;

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private router: Router
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.cargando = true;
      this.obtenerUsuario(Number(id));
    }
  }

  obtenerUsuario(id: number) {
    this.http.get<Usuario>(`${this.api}/users/${id}`).subscribe({
      next: (data) => {
        this.usuario = {
          id: data.id,
          nombre: data.nombre ?? '',
          apellido: data.apellido ?? '',
          dni: data.dni ?? '',
          telefono: data.telefono ?? '',
          email: data.email ?? '',
          nivel: data.nivel === 'Basico' ? 'Básico' : (data.nivel ?? ''),
          planMensual: (data.planMensual ?? '').toString()
        };
        this.cargando = false;
      },
      error: (err) => {
        this.esError = true;
        this.mensajeModal = '❌ Error al cargar usuario: ' + (err.error?.message || err.message);
        this.modalVisible = true;
        this.cargando = false;
      }
    });
  }

  guardarCambios() {
    const planMensualNum = parseInt(this.usuario.planMensual, 10);
    const payload = {
      ...this.usuario,
      planMensual: Number.isNaN(planMensualNum) ? 0 : planMensualNum, // 0 = suelta/prueba
      nivel: this.usuario.nivel === 'Básico' ? 'Basico' : this.usuario.nivel
    };
    this.http
      .patch<Usuario>(`${this.api}/users/modificarUsuario/${this.usuario.id}`, this.usuario)
      .subscribe({
        next: () => {
          // Mostrar modal de éxito
          this.mensajeModal = '✅ Usuario actualizado correctamente';
          this.esError = false;
          this.modalVisible = true;
          setTimeout(() => {
            this.modalVisible = false;
            this.router.navigate(['/listar-alumnos']);
          }, 2500);
        },
        error: (err) => {
          this.mensajeModal = '❌ Error al actualizar: ' + (err.error?.message || err.message);
          this.esError = true;
          this.modalVisible = true;
          setTimeout(() => {
            this.modalVisible = false;
          }, 3000);
        }
      });
  }

  cerrarFormulario() {
    this.router.navigate(['/listar-alumnos']);
  }
}

import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NgIf } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';
import { environment } from '@env/environment';

@Component({
  selector: 'app-invitaciones',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf],
  templateUrl: './invitaciones.component.html',
  styleUrls: ['./invitaciones.component.css']
})
export class InvitacionesComponent {
  form: FormGroup;
  generatedLink: string = '';
  success: string = '';
  error: string = '';
  linkWhatsapp: string = '';
  private api = environment.apiUrl;
  private frontBaseUrl = environment.frontBaseUrl;

  private aplicarReglasRol(rol: 'admin' | 'alumno') {
    const nivelCtrl = this.form.get('nivel')!;
    if (rol === 'admin') {
      nivelCtrl.clearValidators();
      nivelCtrl.setValue('');
    } else {
      nivelCtrl.setValidators([Validators.required]);
    }
    nivelCtrl.updateValueAndValidity({ emitEvent: false });
  }

  constructor( private router: Router, private fb: FormBuilder, private http: HttpClient, public auth: AuthService) {
    this.form = this.fb.group({
      telefono: ['', [Validators.required, Validators.pattern(/^[0-9]{10,13}$/)]],
      nivel: [''],
      rol: ['alumno'],
    });

    this.form.get('rol')!.valueChanges.subscribe((rol) => {
      this.aplicarReglasRol(rol as 'admin' | 'alumno');
    });

    // inicializa según valor inicial
    this.aplicarReglasRol(this.form.get('rol')!.value as 'admin' | 'alumno'); 

  }
 
  get esAdmin(): boolean {
    const rol = (localStorage.getItem('rol') || '').toLowerCase();
    return (rol === 'admin' || rol === 'superadmin') && this.auth.isLoggedIn();
  }

  async enviarInvitacion() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // 1) rol elegido (si no existe control "rol", queda alumno)
    const rolForm = (this.form.value.rol ?? 'alumno') as 'admin' | 'alumno';
    const rol: 'admin' | 'alumno' = this.esSuperadmin ? rolForm : 'alumno';


    // 2) armar payload mínimo
    const payload: any = {
      telefono: (this.form.value.telefono ?? '').toString().trim(),
      rol,
    };

    // 3) si es alumno, nivel obligatorio
    if (rol === 'alumno') {
      const nivel = (this.form.value.nivel ?? '').toString().trim();
      if (!nivel) {
        this.error = 'Seleccioná un nivel para invitar alumnos.';
        this.success = '';
        await Swal.fire({
          icon: 'warning',
          title: 'Falta nivel',
          width: '350px',
          text: this.error,
        });
        return;
      }
      payload.nivel = nivel;
    }

    // 4) endpoint según rol
    const endpoint =
      rol === 'admin'
        ? `${this.api}/auth/invitar-admin`
        : `${this.api}/auth/invitar`;

    try {
      // 5) llamado usando endpoint + payload (en vez de this.form.value)
      const res: any = await this.http.post(endpoint, payload).toPromise();

      if (res.reactivar && res.userId) {
        const resultado = await Swal.fire({
          title: 'Usuario inactivo encontrado',
          text: `El usuario ${res.nombre} ya existe pero está inactivo. ¿Deseas reactivarlo?`,
          width: '350px',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Sí, reactivarlo',
          cancelButtonText: 'Cancelar'
        });

        if (resultado.isConfirmed) {
          await this.http.patch(
            `${this.api}/users/reactivar/${res.userId}`,
            {}
          ).toPromise();

          const respuesta: any = await this.http.post(
            `${this.api}/auth/reset-link-whatsapp`,
            { usuario: res.telefono }
          ).toPromise();

          this.success = `✅ Usuario reactivado. Se le envió un WhatsApp para restablecer la contraseña.`;
          this.linkWhatsapp = respuesta.whatsappUrl;

          await Swal.fire({
            title: 'Reactivado con éxito',
            text: 'Se envió un mensaje por WhatsApp al usuario.',
            width: '350px',
            icon: 'success',
            confirmButtonText: 'Aceptar'
          });

          window.open(this.linkWhatsapp, '_blank');
          return;
        } else {
          this.success = '';
          this.error = 'Operación cancelada por el administrador.';
          return;
        }
      }

      if (res.token) {
        const generatedLink = `${this.frontBaseUrl}/#/register?token=${res.token}`;
        this.generatedLink = generatedLink;
        const numeroSinEspacios = payload.telefono.replace(/\s/g, '');
        const textoPlano = [
          '¡Hola! Soy XXX de Demos Estudio...',
          'Te envío el link para completar tu registro:',
          generatedLink,
          '',
          'Luego de registrarte instalá la app web en tu dispositivo para tener acceso directo:',
          '',
          '• ANDROID (Chrome):',
          '  Tocá Menú (tres puntitos) -> "Agregar a pantalla principal" -> Agregar.',
          '',
          '• iPHONE (Safari):',
          '  Tocá Compartir (cuadrado con flecha) -> "Agregar a pantalla de inicio" -> Añadir.',
          '',
          '• PC (Chrome):',
          '  Icono de instalar en la barra de direcciones o Menú -> "Instalar app".',
          '',
          'Cuando abras la app, iniciá sesión con tu usuario y contraseña. ¡Listo!'
        ].join('\n');

        const texto = encodeURIComponent(textoPlano);
        const linkWhatsapp = `https://wa.me/54${numeroSinEspacios}?text=${texto}`;
        this.linkWhatsapp = linkWhatsapp;

        const result = await Swal.fire({
          title: 'Invitación lista',
          text: 'El link fue generado correctamente. ¿Qué querés hacer?',
          width: '350px',
          icon: 'success',
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: 'Abrir WhatsApp',
          denyButtonText: 'Copiar link',
          cancelButtonText: 'Cerrar'
        });

        if (result.isConfirmed) {
          window.open(linkWhatsapp, '_blank');
          return;
        } else if (result.isDenied) {
          await navigator.clipboard.writeText(generatedLink);
          await Swal.fire('Copiado', 'El link fue copiado al portapapeles.', 'success');
          return;
        }

        return;
      }

      // Si no hubo reactivación ni token, avisá algo por defecto
      this.error = 'No se pudo generar la invitación.';
      this.success = '';

    } catch (err: any) {
      this.success = '';
      this.error = err?.error?.message || 'Error al generar la invitación.';
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        width: '350px',
        text: this.error,
      });
    }
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/']); 
  }

  copiarAlPortapapeles() {
    navigator.clipboard.writeText(this.generatedLink || '');
  }
  
  cerrarFormulario(): void {
    this.router.navigate(['/gestion-turnos']);
  }

  get esSuperadmin(): boolean {
    return (localStorage.getItem('rol') || '').toLowerCase() === 'superadmin' && this.auth.isLoggedIn();
  }


}
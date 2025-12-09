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


  constructor( private router: Router, private fb: FormBuilder, private http: HttpClient, public auth: AuthService) {
    this.form = this.fb.group({
      telefono: ['', [Validators.required, Validators.pattern(/^[0-9]{10,13}$/)]],
      nivel: ['', Validators.required],
    });
  }
 
  get esAdmin(): boolean {
    return localStorage.getItem('rol') === 'admin' && this.auth.isLoggedIn();
  }
  
  async enviarInvitacion() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    try {
      const res: any = await this.http.post(
        `${this.api}/auth/invitar`,
        this.form.value
      ).toPromise();

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
            { telefono: res.telefono }
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
        const numeroSinEspacios = this.form.value.telefono.replace(/\s/g, '');
        const textoPlano = [
          '¡Hola! Soy Lucía Carletta...',
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

}
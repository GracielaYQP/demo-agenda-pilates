import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-normas-basicas',
  standalone: true,
  imports: [],
  templateUrl: './normas-basicas.component.html',
  styleUrl: './normas-basicas.component.css'
})
export class NormasBasicasComponent {
  constructor(private router: Router) {}

  volverAlInicio() {
    this.router.navigate(['/']);
  }
}

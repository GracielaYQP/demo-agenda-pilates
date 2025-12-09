import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-acerca-de',
  standalone: true,
  imports: [],
  templateUrl: './acerca-de.component.html',
  styleUrl: './acerca-de.component.css'
})
export class AcercaDeComponent {
  constructor(private router: Router) {}

    volverAlInicio() {
    this.router.navigate(['/']);
  }
}

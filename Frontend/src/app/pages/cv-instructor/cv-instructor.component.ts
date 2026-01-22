import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-cv-instructor',
  standalone: true,
  imports: [],
  templateUrl: './cv-instructor.component.html',
  styleUrl: './cv-instructor.component.css'
})
export class CvInstructorComponent {
  constructor(private router: Router) {}
  
      volverAlInicio() {
      this.router.navigate(['/']);
    }

}

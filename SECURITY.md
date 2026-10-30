# Política de seguridad

La seguridad de CodePanel incluye el código de la aplicación, la API, la base de datos, las sesiones y el almacenamiento privado de archivos.

## Versiones con soporte

CodePanel evoluciona como un proyecto privado. Sólo la versión estable más reciente y la rama principal activa reciben correcciones de seguridad.

| Versión | Soporte |
| --- | --- |
| Última versión estable | Sí |
| Versiones anteriores | No garantizado |
| Copias modificadas por terceros | No |

## Reportar una vulnerabilidad

No abras un issue, una discusión ni un pull request público con información sobre una vulnerabilidad.

El canal preferido es **Private vulnerability reporting** dentro de la pestaña *Security* del repositorio, cuando esa función esté habilitada. Si no está disponible, utiliza el mismo canal privado por el que el titular [@Valentindg2506](https://github.com/Valentindg2506) te concedió acceso al proyecto e indica que necesitas comunicar un problema de seguridad. El perfil público, los issues, las discusiones y los pull requests no son canales de reporte.

El reporte debería incluir:

- componente y versión afectados;
- descripción del impacto;
- pasos mínimos para reproducir el problema;
- evidencia no destructiva, si existe;
- posibles medidas de mitigación;
- un medio privado para continuar la conversación.

No incluyas contraseñas reales, tokens, volcados de bases de datos, archivos de usuarios ni otros secretos. Si encontraste una credencial, no la pruebes ni la compartas públicamente.

## Proceso de respuesta

El objetivo es confirmar la recepción dentro de siete días, evaluar el alcance y definir una corrección según la gravedad. El proyecto no ofrece un SLA contractual y puede necesitar más tiempo para investigar problemas complejos.

Cuando corresponda, se coordinarán de forma privada la solución, la publicación y el reconocimiento del reporte. La vulnerabilidad no debe divulgarse antes de que exista una corrección o un acuerdo explícito de divulgación.

## Investigación de buena fe

Una investigación autorizada debe limitarse a datos y cuentas propias, minimizar cualquier impacto y detenerse si existe riesgo de pérdida de información o interrupción del servicio.

No están autorizados:

- el acceso a datos de otras personas;
- la ingeniería social o suplantación de identidad;
- los ataques de denegación de servicio;
- la destrucción, modificación o extracción masiva de información;
- las pruebas sobre instalaciones sin permiso de su propietario;
- el uso de una vulnerabilidad con una finalidad distinta de reportarla.

Esta política no concede una licencia para copiar, modificar o redistribuir CodePanel. Los derechos sobre el proyecto se rigen por [LICENSE](LICENSE).

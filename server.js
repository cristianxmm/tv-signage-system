const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// --- NUEVAS LIBRERÍAS ---
const multer = require('multer');
const XLSX = require('xlsx');

// Configuración de subida de archivos
const upload = multer({ dest: 'uploads/' });

// Servir la carpeta pública (SOLO UNA VEZ)
app.use(express.static(path.join(__dirname, 'public')));

// --- RUTA: PROCESAR EXCEL ---
app.post('/subir-excel', upload.single('archivo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se subió ningún archivo');
        }

        // 1. Leer el archivo Excel
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        // 2. Convertir a HTML
        const tablaHTML = XLSX.utils.sheet_to_html(sheet);

        // 3. Crear HTML con estilos oscuros
        const htmlFinal = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { background: #1a1a1a; color: white; font-family: sans-serif; padding: 20px; display: flex; justify-content: center; }
                    table { border-collapse: collapse; width: 90%; background: #333; box-shadow: 0 0 20px rgba(0,0,0,0.5); margin-top: 20px; }
                    th, td { padding: 15px; text-align: left; border-bottom: 1px solid #555; font-size: 1.2rem; }
                    tr:hover { background-color: #444; }
                    th { background-color: #007bff; color: white; font-weight: bold; font-size: 1.5rem; }
                </style>
                <script src="/socket.io/socket.io.js"></script>
                <script>
                   const socket = io();
                   // Recuperar nombre de la URL si existe para reconectarse a su sala
                   const params = new URLSearchParams(window.location.search);
                   const nombreTV = params.get('nombre') || 'sin-nombre';
                   
                   socket.on('connect', () => {
                       socket.emit('registro_tv', nombreTV);
                   });

                   // Escuchar cambios para salir del modo Excel si el admin manda otra cosa
                   socket.on('update_screen', (url) => {
                       // Mantenemos el nombre de la TV en la URL al cambiar
                       if(url.includes('?')) window.location.href = url;
                       else window.location.href = url + '?nombre=' + nombreTV;
                   });
                </script>
            </head>
            <body>
                ${tablaHTML}
            </body>
            </html>
        `;

        // 4. Guardar archivo
        const rutaSalida = path.join(__dirname, 'public', 'datos.html');
        fs.writeFileSync(rutaSalida, htmlFinal);

        // Borrar temporal
        fs.unlinkSync(req.file.path);

        res.json({ url: '/datos.html', message: '¡Excel convertido con éxito!' });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error al procesar el Excel');
    }
});

// --- MANEJO DE CONEXIONES (SOCKET.IO) ---
io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);

    // 1. Escuchar cuando una TV dice "Soy Ventas"
    socket.on('registro_tv', (nombreTV) => {
        socket.join(nombreTV);
        console.log(`Socket ${socket.id} unido a sala: ${nombreTV}`);
    });

    // 2. Escuchar orden del Admin
    socket.on('admin_command', (data) => {
        const { target, url } = data;
        console.log(`Orden para ${target}: ${url}`);
        
        if(target === 'all') {
            io.emit('update_screen', url);
        } else {
            // Enviar SOLO a la sala específica
            io.to(target).emit('update_screen', url);
        }
    });

    socket.on('disconnect', () => {
        console.log('Dispositivo desconectado');
    });
});

const PORT = process.env.PORT || 80;
http.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
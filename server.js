const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// --- CONFIGURACIÓN ---
// Usamos puerto 80 para facilitar acceso a TVs (requiere sudo)
const PORT = 80; 

// Configurar Multer (Carga de archivos)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
});
const upload = multer({ storage: storage });

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}

// --- RUTAS ---

// 1. Ruta para subir Excel
app.post('/subir-excel', upload.single('archivo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se subió ningún archivo.');
        }

        // Leer el archivo Excel
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Ver a quién se lo enviamos (viene del Admin)
        const target = req.body.target || 'all'; // 'all', 'recepcion', 'almacen', etc.

        console.log(`📡 Enviando Excel a: ${target}`);

        // Enviar datos vía Socket.io
        if (target === 'all') {
            io.emit('excelData', data); // A todos
        } else {
            io.to(target).emit('excelData', data); // A una sala específica
        }

        res.send({ status: 'ok', message: 'Enviado correctamente a ' + target });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error procesando el archivo');
    }
});

// --- SOCKET.IO (CONEXIONES EN TIEMPO REAL) ---
io.on('connection', (socket) => {
    console.log('⚡ Nuevo cliente conectado');

    // El cliente nos dice quién es (ej: "recepcion")
    socket.on('join', (room) => {
        console.log(`📺 Pantalla se unió a la sala: ${room}`);
        socket.join(room); // Unimos este socket a esa sala
    });

    socket.on('disconnect', () => {
        console.log('🔴 Cliente desconectado');
    });
});

// --- ARRANCAR SERVIDOR ---
http.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
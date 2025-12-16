const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Servir la carpeta pública
app.use(express.static(path.join(__dirname, 'public')));

// Manejo de conexiones
io.on('connection', (socket) => {
    console.log('Dispositivo conectado:', socket.id);

    // Escuchar evento desde el Admin
    socket.on('admin_command', (data) => {
        console.log(`Orden recibida para ${data.target}: ${data.url}`);
        
        // Si el target es 'all', envía a todos
        if(data.target === 'all') {
            io.emit('update_screen', data.url);
        } else {
            // Aquí prepararemos la lógica para pantallas individuales más adelante
            // Por ahora, broadcast a todos
            io.emit('update_screen', data.url);
        }
    });

    socket.on('disconnect', () => {
        console.log('Dispositivo desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
let slice_vs_src = `#version 300 es
in vec2 vert_pos;
uniform vec3 lower_bounds;
uniform vec3 upper_bounds;
uniform mat4 M_slice;
uniform mat4 M_proj;
uniform float slice_width;
out vec2 uv;
out vec4 xyz;

void main(){
    gl_Position = vec4(vert_pos, 0.5, 1.);
    uv = (vert_pos.xy + 1.) / 2.;
    xyz = M_slice * vec4(
        // slice_width * (0.5 - vert_pos.y / 2.),
        (lower_bounds.x + upper_bounds.x - slice_width * vert_pos.y) / 2.,
        0.,
        - vert_pos.x * slice_width / 2.,
        1.
    );
    gl_Position = M_proj * xyz;
}

`;

let slice_fs_src = `#version 300 es
precision highp float;
precision highp sampler3D;

#define boarder_width 0.01

in vec2 uv;
in vec4 xyz;
out vec4 frag_color;
uniform sampler3D data;
uniform vec3 lower_bounds;
uniform vec3 upper_bounds;

void main(){
    // frag_color = vec4(vec3(val), 1.);
    vec3 rpt = vec3(
        length(xyz.xyz),
        atan(xyz.z, xyz.x),
        atan(xyz.y, length(xyz.xz))
    );
    vec3 uv_tex = (rpt - lower_bounds) / (upper_bounds - lower_bounds);
    float val = texture(data, uv_tex).r;
    frag_color = vec4(vec3(val), 1.);
    if (any(lessThan(uv, vec2(boarder_width))) || any(greaterThan(uv, vec2(1. - boarder_width)))){
        frag_color = vec4(0., 1., 0., 1);
    } else if (any(lessThan(uv_tex, vec3(0.))) || any(greaterThan(uv_tex, vec3(1.)))){
        discard;
        // frag_color = vec4(uv, 1., 1.);
    }
}

`;

let wireframe_vs_src = `#version 300 es
in vec3 pt_pos;
uniform vec3 lower_bounds;
uniform vec3 upper_bounds;
// uniform float print_width;
uniform mat4 M_proj;

void main(){
    vec3 rpt = pt_pos * (upper_bounds - lower_bounds) + lower_bounds;
    vec4 xyz = vec4(
        rpt.x * cos(rpt.y) * cos(rpt.z),
        rpt.x * sin(rpt.z),
        rpt.x * sin(rpt.y) * cos(rpt.z),
        // 0., 0.,
        1.
    );
    // xyz = vec4(pt_pos * upper_bounds.x, 1.);

    gl_Position = M_proj * xyz;
    // gl_Position = vec4(pt_pos, 1.);
    // gl_Position = vec4(rpt.x / upper_bounds.x, rpt.z, rpt.y, 1.);
}

`;

let wireframe_fs_src = `#version 300 es
precision highp float;
precision highp sampler3D;

out vec4 frag_color;

void main(){
    frag_color = vec4(1., 0., 0., 1.);
}
`;


let probe_vs_src = `#version 300 es
in vec3 pt_pos;
in vec3 norm;
uniform mat4 M_proj;
uniform mat4 M_slice;
out vec3 color;
#define scale 20.
#define lighting vec3(1., 1., 1.)

void main(){
    gl_Position = M_proj * M_slice * vec4(-pt_pos.z * scale, pt_pos.y * scale, pt_pos.x * scale, 1.);
    color = vec3(0.5 * dot(norm, normalize(lighting)) + 0.5);
}

`;


let probe_fs_src = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec3 color;
out vec4 frag_color;

void main(){
    // frag_color = vec4(0., 1., 1., 1.);
    frag_color = vec4(color, 1.);
}
`;


var fps = 1;
var n_frames = 0;
var [n_row, n_phi, n_theta] = [0, 0, 0];
var [rho_min, rho_max, phi_min, phi_max, theta_min, theta_max] = [0, 1, -1, 1, -1, 1];
var i_frame = 0;
var data = null;
var slice_program = null;
var wireframe_program = null;
var canvas = null;
var gl = null;
let M_slice = new Float32Array(16);
let M_proj = new Float32Array(16);
var vert_buffer, tri_buffer, wireframe_buffer, probe_buffer;
var probe_mesh = null;
var slice_width = 1;
let M_perspective = new Float32Array(16);

// mouse globals
var mouse_down_pos = [0, 0];
var mouse_down_rots = [0, 0];
var rot_z = 0;
var rot_x = 0;
var mouse_zoom = -200
var d_last = null;
var mouse_is_down = false;
let M_camera = new Float32Array(16);

var pd_mouse_down = false;
const phase_diagram_corners = [
    74, 35, 771, 235
];
var phase_diagram_view = 'a4c';
const n_examples = 3;


let screen_mesh = [

    [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
    ],
    
    [
        [0, 1, 2],
        [0, 2, 3]
    ]
    
];


function make_wireframe(){
    let n = 100;
    let out = [];
    for (var i = 0; i < n; i++){
        var val1 = i / n;
        var val2 = (i + 1) / n;
        // edge 1
        out.push([0, 0, val1]);
        out.push([0, 0, val2])

        // edge 2
        out.push([0, val1, 1])
        out.push([0, val2, 1]);

        // edge 3
        out.push([0, 1, val1])
        out.push([0, 1, val2]);

        // edge 4
        out.push([0, val1, 0])
        out.push([0, val2, 0]);

        // edge 5
        out.push([1, 0, val1])
        out.push([1, 0, val2]);

        // edge 6
        out.push([1, val1, 1])
        out.push([1, val2, 1]);

        // edge 7
        out.push([1, 1, val1])
        out.push([1, 1, val2]);

        // edge 8
        out.push([1, val1, 0])
        out.push([1, val2, 0]);
    }
    out.push([0, 0, 0, 1, 0, 0]);
    out.push([0, 0, 1, 1, 0, 1]);
    out.push([0, 1, 1, 1, 1, 1]);
    out.push([0, 1, 0, 1, 1, 0]);
    return out;
}


function load_data(path){
    let req = new XMLHttpRequest();
    req.open('GET', path);
    req.responseType = 'arraybuffer';
    req.onreadystatechange = function(){
        if (this.readyState == 4 && this.status == 200){
            let buffer = req.response;
            [n_frames, n_theta, n_phi, n_rho] = new Uint16Array(buffer.slice(0, 4 * 2));
            [fps, rho_min, rho_max, theta_min, theta_max, phi_min, phi_max] = new Float32Array(buffer.slice(4 * 2, 4 * 2 + 4 * 7));
            data = new Uint8Array(buffer.slice(4 * 2 + 4 * 7));
            slice_width = 2 * rho_max * Math.max(
                Math.sin(theta_max) ** 2 + Math.cos(theta_max) ** 2 * Math.sin(phi_max) ** 2,
                Math.sin(theta_min) ** 2 + Math.cos(theta_min) ** 2 * Math.sin(phi_max) ** 2,
                Math.sin(theta_max) ** 2 + Math.cos(theta_max) ** 2 * Math.sin(phi_min) ** 2,
                Math.sin(theta_min) ** 2 + Math.cos(theta_min) ** 2 * Math.sin(phi_min) ** 2,
            ) ** 0.5;
            
            // mat4.identity(M_proj);
            // mat4.lookAt(M_proj, [30, 200, -400], [(rho_max + rho_min) / 2, 0, 0], [-1, 0, 0]);
            // let p = new Float32Array(16);
            // mat4.perspective(p, glMatrix.toRadian(45), 1, 0.1, 10000);
            // mat4.multiply(M_proj, p, M_proj);

            console.log('loaded new data ', n_frames, n_rho, n_phi, n_theta);
            document.getElementById('loading').style.display = "none";
        } else if (this.readyState == 4){
            console.log('failed to load' + path);
        }
    }
    document.getElementById('loading').style.display = "block";
    req.send();
}


function range(arr){
    var min = max = arr[0];
    for (i = 0; i < arr.length; i++){
        if (arr[i] < min) min = arr[i];
        if (arr[i] > max) max = arr[i];
    }
    return [min, max];
}


function update_slice(rot, t){
    // let rot = parseFloat(document.getElementById('rot-slider').value);
    // let t = parseFloat(document.getElementById('t-slider').value);
    mat4.identity(M_slice);
    mat4.rotate(M_slice, M_slice, glMatrix.toRadian(rot), [1, 0, 0]);
    mat4.translate(M_slice, M_slice, [0, t * rho_max, 0]);
}


function draw_slice(){
    gl.useProgram(slice_program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tri_buffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    let vert_pos_attr = gl.getAttribLocation(slice_program, 'vert_pos');
    gl.vertexAttribPointer(
        vert_pos_attr,
        2, gl.FLOAT, gl.FALSE, 2 * 4, 0
    );
    gl.enableVertexAttribArray(vert_pos_attr);
    // update_slice();
    gl.uniformMatrix4fv(gl.getUniformLocation(slice_program, 'M_slice'), gl.False, M_slice);
    gl.uniformMatrix4fv(gl.getUniformLocation(slice_program, 'M_proj'), gl.False, M_proj);
    gl.uniform3f(gl.getUniformLocation(slice_program, 'lower_bounds'), rho_min, phi_min, theta_min);
    gl.uniform3f(gl.getUniformLocation(slice_program, 'upper_bounds'), rho_max, phi_max, theta_max);
    gl.uniform1f(gl.getUniformLocation(slice_program, 'slice_width'), slice_width);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, screen_mesh[1].length * 3, gl.UNSIGNED_SHORT, 0);

}

function draw_wireframe(){
    gl.useProgram(wireframe_program);
    gl.bindBuffer(gl.ARRAY_BUFFER, wireframe_buffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    let vert_pos_attr = gl.getAttribLocation(wireframe_program, 'pt_pos');
    gl.vertexAttribPointer(
        vert_pos_attr,
        3, gl.FLOAT, gl.FALSE, 3 * 4, 0
    );
    gl.enableVertexAttribArray(vert_pos_attr);
    // update_slice();
    gl.uniformMatrix4fv(gl.getUniformLocation(wireframe_program, 'M_proj'), gl.False, M_proj);
    gl.uniform3f(gl.getUniformLocation(wireframe_program, 'lower_bounds'), rho_min, phi_min, theta_min);
    gl.uniform3f(gl.getUniformLocation(wireframe_program, 'upper_bounds'), rho_max, phi_max, theta_max);
    gl.uniform1f(gl.getUniformLocation(wireframe_program, 'slice_width'), slice_width);
    gl.drawArrays(gl.LINES, 0, wireframe.length * 2);
}

function draw_probe(){
    if (probe_mesh == null) return;
    gl.useProgram(probe_program);
    gl.bindBuffer(gl.ARRAY_BUFFER, probe_buffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    let vert_pos_attr = gl.getAttribLocation(probe_program, 'pt_pos');
    gl.vertexAttribPointer(
        vert_pos_attr,
        3, gl.FLOAT, gl.FALSE, 6 * 4, 0
    );
    gl.enableVertexAttribArray(vert_pos_attr);
    let norm_pos_attr = gl.getAttribLocation(probe_program, 'norm');
    gl.vertexAttribPointer(
        norm_pos_attr,
        3, gl.FLOAT, gl.FALSE, 6 * 4, 3 * 4
    );
    gl.enableVertexAttribArray(norm_pos_attr);
    
    gl.uniformMatrix4fv(gl.getUniformLocation(probe_program, 'M_slice'), gl.False, M_slice);
    gl.uniformMatrix4fv(gl.getUniformLocation(probe_program, 'M_proj'), gl.False, M_proj);
    // gl.uniform3f(gl.getUniformLocation(probe_program, 'lower_bounds'), rho_min, phi_min, theta_min);
    // gl.uniform3f(gl.getUniformLocation(probe_program, 'upper_bounds'), rho_max, phi_max, theta_max);
    // gl.uniform1f(gl.getUniformLocation(probe_program, 'slice_width'), slice_width);
    gl.drawArrays(gl.TRIANGLES, 0, probe_mesh.length);
}


function get_event_xy(event){
    if (gl == null) return [-1, -1, 0];

    var event_x, event_y;
    var d = null;
    if (event.type.startsWith('mouse')){
        event_x = event.offsetX / canvas.width;
        event_y = event.offsetY / canvas.height;
    } else {
        
        // event.preventDefault();
        if (event.touches.length == 2){
            let [x1, y1] = [event.touches[0].clientX, event.touches[0].clientY];
            let [x2, y2] = [event.touches[1].clientX, event.touches[1].clientY];
            d = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5;
            event_x = 0.5 * (x1 + x2) / canvas.width;
            event_y = 0.5 * (y1 + y2) / canvas.height;
        } else {
            event_x = event.touches[0].clientX / canvas.width;
            event_y = event.touches[0].clientY / canvas.height;
        }
    }
    return [event_x, 1. - event_y, d];
}


function mouse_down(event){
    var [event_x, event_y, d] = get_event_xy(event);
    mouse_is_down = true;
    mouse_down_pos[0] = event_x;
    mouse_down_pos[1] = event_y;
    d_last = d;
}


function mouse_move(event){
    var [event_x, event_y, d] = get_event_xy(event);
    if (mouse_is_down){
        rot_x = event_x - mouse_down_pos[0] + mouse_down_rots[0];
        rot_y = event_y - mouse_down_pos[1] + mouse_down_rots[1];
        mat4.identity(M_camera);
        mat4.translate(M_camera, M_camera, [0, 0, -400]);
        mat4.rotate(M_camera, M_camera, glMatrix.toRadian(90), [0, 0, -1]);
        mat4.rotate(M_camera, M_camera, 2. * rot_y, [0, -1, 0]);
        mat4.rotate(M_camera, M_camera, 2. * rot_x, [-1, 0, 0]);
        mat4.translate(M_camera, M_camera, [-(rho_max + rho_min) / 2, 0, 0]);
    }
    if (d != null && d_last != null){
        mouse_zoom += 0.5 * (d - d_last);
    }
    d_last = d;
}


function mouse_up(event){
    var [event_x, event_y, d] = get_event_xy(event);
    if (mouse_is_down){
        mouse_down_rots[0] += event_x - mouse_down_pos[0];
        mouse_down_rots[1] += event_y - mouse_down_pos[1];    
    }
    mouse_is_down = false;
    d_last = null;
}


function move_cross(event){
    // console.log(event.offsetX, event.offsetY);
    let e = document.getElementById('cross');
    let rot = 360 * (event.offsetX - phase_diagram_corners[0]) / (phase_diagram_corners[2] - phase_diagram_corners[0]);
    let t = (event.offsetY - phase_diagram_corners[1]) / (phase_diagram_corners[3] - phase_diagram_corners[1]) - 0.5;
    if (pd_mouse_down && rot >= 0 && t >= -0.5 && rot <= 360 && t <= 0.5){
        // console.log(rot, t);
        e.style.top = (event.clientY - e.height / 2) + 'px';
        e.style.left = (event.clientX - e.width / 2) + 'px';
        update_slice(rot, t);
    }
}


function load_example(i){
    document.getElementById('phase-diagram').src = 'example_' + i + '_' + phase_diagram_view + '.svg';
    document.getElementById('dropdown').innerText = 'Example ' + i;
    load_data('example_' + i + '.3de');
}


function change_diagram(view){
    phase_diagram_view = view;
    let i = parseInt(document.getElementById('dropdown').innerText.split(' ')[1]);
    document.getElementById('phase-diagram').src = 'example_' + i + '_' + phase_diagram_view + '.svg';
    document.getElementById('phase-diagram-dropdown').innerText = phase_diagram_view.toUpperCase();
}


function add_examples(){
    let html = '';
    for (var i = 0; i < n_examples; i++){
        html += '\n            <a class="dropdown-item" href="#" onclick="load_example(' + i.toString() + ');">Example ' + i.toString() + '</a>'
    }
    let list_e = document.getElementById('example-list');
    list_e.innerHTML = html;
}


function load_probe_mesh(){
    let req = new XMLHttpRequest();
    req.open('GET', 'probe.pts');
    // req.open('GET', 'probe.pts');
    req.responseType = 'arraybuffer';
    req.onreadystatechange = function(){
        if (this.readyState == 4 && this.status == 200){
            let buffer = req.response;
            probe_mesh = new Float32Array(buffer);
            probe_buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, probe_buffer);
            gl.bufferData(gl.ARRAY_BUFFER, probe_mesh, gl.STATIC_DRAW);
            console.log('loaded probe mesh', probe_mesh.length / 9);
        } else if (this.readyState == 4){
            console.log('failed to load' + path);
        }
    }
    document.getElementById('loading').style.display = "block";
    req.send();

}


function init(){

    add_examples();

    let p = new Float32Array(16);
    mat4.perspective(M_perspective, glMatrix.toRadian(45), 1, 0.1, 10000);
    mat4.identity(M_camera);
    mat4.translate(M_camera, M_camera, [0, 0, -400]);
    mat4.rotate(M_camera, M_camera, glMatrix.toRadian(90), [0, 0, -1]);
    mat4.translate(M_camera, M_camera, [-50, 0, 0]);

    // setup gl
    canvas = document.getElementById('gl-canvas');
    [canvas.width, canvas.height] = [canvas.clientWidth, canvas.clientHeight];
    gl = canvas.getContext('webgl2');
    if (!gl) alert('Browser must support WebGL2');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);

    // create buffers
    vert_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(screen_mesh[0].flat()), gl.STATIC_DRAW);
    tri_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tri_buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(screen_mesh[1].flat()), gl.STATIC_DRAW);
    
    // pt_buffer = gl.createBuffer();
    // gl.bindBuffer(gl.ARRAY_BUFFER, pt_buffer);
    // gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wireframe[0].flat()), gl.STATIC_DRAW);
    // line_buffer = gl.createBuffer();
    // gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, line_buffer);
    // gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(wireframe[1].flat()), gl.STATIC_DRAW);
    wireframe = make_wireframe();
    wireframe_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, wireframe_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wireframe.flat()), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    // TODO load probe mesh
    load_probe_mesh();
    
    // create texture
    let data_tex = gl.createTexture(gl.TEXTURE_3D);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, data_tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    // compile & link program
    let slice_vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(slice_vs, slice_vs_src);
    gl.compileShader(slice_vs);
    if (!gl.getShaderParameter(slice_vs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(slice_vs));
        return;
    }
    let slice_fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(slice_fs, slice_fs_src);
    gl.compileShader(slice_fs);
    if (!gl.getShaderParameter(slice_fs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(slice_fs));
        return;
    }
    slice_program = gl.createProgram();
    gl.attachShader(slice_program, slice_vs);
    gl.attachShader(slice_program, slice_fs);
    gl.linkProgram(slice_program);
    if (!gl.getProgramParameter(slice_program, gl.LINK_STATUS)){
        console.error('Failed to link program:', gl.getProgramInfoLog(slice_program));
        return;
    }
    gl.validateProgram(slice_program);
    if (!gl.getProgramParameter(slice_program, gl.VALIDATE_STATUS)){
        console.error('Failed to validate program:', gl.getProgramInfoLog(slice_program));
        return;
    }
    
    let wireframe_vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(wireframe_vs, wireframe_vs_src);
    gl.compileShader(wireframe_vs);
    if (!gl.getShaderParameter(wireframe_vs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(wireframe_vs));
        return;
    }
    let wireframe_fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(wireframe_fs, wireframe_fs_src);
    gl.compileShader(wireframe_fs);
    if (!gl.getShaderParameter(wireframe_fs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(wireframe_fs));
        return;
    }
    wireframe_program = gl.createProgram();
    gl.attachShader(wireframe_program, wireframe_vs);
    gl.attachShader(wireframe_program, wireframe_fs);
    gl.linkProgram(wireframe_program);
    if (!gl.getProgramParameter(wireframe_program, gl.LINK_STATUS)){
        console.error('Failed to link program:', gl.getProgramInfoLog(wireframe_program));
        return;
    }
    gl.validateProgram(wireframe_program);
    if (!gl.getProgramParameter(wireframe_program, gl.VALIDATE_STATUS)){
        console.error('Failed to validate program:', gl.getProgramInfoLog(wireframe_program));
        return;
    }
    
    let probe_vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(probe_vs, probe_vs_src);
    gl.compileShader(probe_vs);
    if (!gl.getShaderParameter(probe_vs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(probe_vs));
        return;
    }
    let probe_fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(probe_fs, probe_fs_src);
    gl.compileShader(probe_fs);
    if (!gl.getShaderParameter(probe_fs, gl.COMPILE_STATUS)){
        console.error('Failed to compile shader:', gl.getShaderInfoLog(probe_fs));
        return;
    }
    probe_program = gl.createProgram();
    gl.attachShader(probe_program, probe_vs);
    gl.attachShader(probe_program, probe_fs);
    gl.linkProgram(probe_program);
    if (!gl.getProgramParameter(probe_program, gl.LINK_STATUS)){
        console.error('Failed to link program:', gl.getProgramInfoLog(probe_program));
        return;
    }
    gl.validateProgram(probe_program);
    if (!gl.getProgramParameter(probe_program, gl.VALIDATE_STATUS)){
        console.error('Failed to validate program:', gl.getProgramInfoLog(probe_program));
        return;
    }

    load_data('example_0.3de');
    
    // mat4.identity(M_proj);

    let loop = function(){
        if (data != null){
            gl.texImage3D(
                gl.TEXTURE_3D,                   // target
                0,                               // mip level
                gl.R8,                           // internal format
                n_rho, n_phi, n_theta,           // w, h, d
                // 2, 2, 1,
                0,                               // boarder === 0
                gl.RED,                          // data format
                gl.UNSIGNED_BYTE,                // data type
                new Uint8Array(data.subarray(                   // data
                    i_frame * n_rho * n_phi * n_theta, 
                    (i_frame + 1) * n_rho * n_phi * n_theta
                ))
                // new Uint8Array([255, 0, 127, 30])
                // new Uint8Array(Array(n_rho * n_phi * n_theta).fill(127))
            );
            i_frame++;
            if (i_frame >= n_frames) i_frame = 0;
        }
        
        mat4.multiply(M_proj, M_perspective, M_camera);
        draw_slice();
        draw_wireframe();
        draw_probe();  //TODO: FIX

        setTimeout(() =>{requestAnimationFrame(loop);}, 1000 / fps);
    };
    requestAnimationFrame(loop);

}
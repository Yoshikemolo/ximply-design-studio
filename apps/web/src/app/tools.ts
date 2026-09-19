/** Built-in tool descriptors form the first trusted tool-plugin registry. */
export type ToolId='select'|'rectangle'|'ellipse'|'path'|'text'|'brush'|'eraser'|'hand';
export interface ToolPlugin {id:ToolId;label:string;shortcut:string;icon:string;cursor:string;}
export const TOOLS:ToolPlugin[]=[
  {id:'select',label:'Select',shortcut:'V',icon:'select',cursor:'default'},
  {id:'hand',label:'Pan',shortcut:'H',icon:'hand',cursor:'grab'},
  {id:'rectangle',label:'Rectangle',shortcut:'R',icon:'rectangle',cursor:'crosshair'},
  {id:'ellipse',label:'Ellipse',shortcut:'O',icon:'ellipse',cursor:'crosshair'},
  {id:'path',label:'Pencil',shortcut:'P',icon:'pencil',cursor:'crosshair'},
  {id:'text',label:'Text',shortcut:'T',icon:'text',cursor:'text'},
  {id:'brush',label:'Brush',shortcut:'B',icon:'brush',cursor:'crosshair'},
  {id:'eraser',label:'Eraser',shortcut:'E',icon:'eraser',cursor:'crosshair'}
];

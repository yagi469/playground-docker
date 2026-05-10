from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import sys
import io
import contextlib
import base64
import matplotlib.pyplot as plt
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os

class CodeRequest(BaseModel):
    code: str

class SaveRequest(BaseModel):
    filename: str
    content: str

from fastapi.responses import Response

import jedi

class CompletionRequest(BaseModel):
    code: str
    line: int
    column: int
    filename: str = "script.py"

@app.post("/complete")
async def get_completions(request: CompletionRequest):
    try:
        # Jedi analyzes the code in the context of the current directory
        script = jedi.Script(request.code, path=request.filename)
        completions = script.complete(request.line, request.column)
        
        return {
            "completions": [
                {
                    "label": c.name,
                    "kind": c.type,
                    "detail": c.description,
                    "documentation": c.docstring(),
                    "insertText": c.name
                } for c in completions
            ]
        }
    except Exception as e:
        return {"completions": [], "error": str(e)}

@app.get("/files")
async def list_files():
    # Exclude system files for safety
    excluded = {'server.py', 'requirements.txt'}
    files = [f for f in os.listdir('.') if (f.endswith('.py') or f.endswith('.png')) and f not in excluded]
    return {"files": sorted(files)}

@app.get("/files/raw/{filename}")
async def read_raw_file(filename: str):
    if filename in {'server.py', 'requirements.txt'} or '..' in filename:
        raise HTTPException(status_code=400, detail="Access denied")
    
    try:
        with open(filename, 'rb') as f:
            content = f.read()
        
        media_type = "image/png" if filename.endswith('.png') else "text/plain"
        return Response(content=content, media_type=media_type)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")

@app.get("/files/{filename}")
async def read_file(filename: str):
    if filename in {'server.py', 'requirements.txt'} or not filename.endswith('.py') or '..' in filename:
        raise HTTPException(status_code=400, detail="Access denied to system files or invalid filename")
    try:
        with open(filename, 'r') as f:
            content = f.read()
        return {"content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")

@app.post("/files/save")
async def save_file(request: SaveRequest):
    if request.filename in {'server.py', 'requirements.txt'} or not request.filename.endswith('.py') or '..' in request.filename:
        raise HTTPException(status_code=400, detail="Cannot overwrite system files or invalid filename")
    with open(request.filename, 'w') as f:
        f.write(request.content)
    return {"success": True}

@app.post("/execute")
async def execute_code(request: CodeRequest):
    # Set backend to Agg for headless plot generation
    plt.switch_backend('Agg')
    
    # Clear existing figures
    plt.close('all')
    
    stdout_buffer = io.StringIO()
    
    try:
        with contextlib.redirect_stdout(stdout_buffer):
            # Execute the code in a local namespace
            local_vars = {}
            exec(request.code, {"plt": plt}, local_vars)
        
        output_text = stdout_buffer.getvalue()
        
        # Check if any figures were created
        images = []
        fig_nums = plt.get_fignums()
        for i in fig_nums:
            fig = plt.figure(i)
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight')
            buf.seek(0)
            img_str = base64.b64encode(buf.read()).decode('utf-8')
            images.append(f"data:image/png;base64,{img_str}")
            plt.close(fig)

        return {
            "stdout": output_text,
            "images": images,
            "success": True
        }
    except Exception as e:
        return {
            "stdout": stdout_buffer.getvalue(),
            "error": str(e),
            "success": False
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

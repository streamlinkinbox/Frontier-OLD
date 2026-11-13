import sys
from PIL import Image
pre=sys.argv[1]; names=sys.argv[2].split(',')
ims=[Image.open('out/%s_%s.png'%(pre,n)).resize((600,600)) for n in names]
S=Image.new('RGB',(1800,600*((len(ims)+2)//3)))
for i,im in enumerate(ims): S.paste(im,((i%3)*600,(i//3)*600))
S.save('out/sheet_%s.png'%pre)
